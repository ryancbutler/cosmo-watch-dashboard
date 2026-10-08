import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FilipClient, normalizeWatches, normalizeNotifications, normalizeSteps, normalizeDailySteps, normalizeGoal, normalizeZones, normalizeSchedules, fetchDashboard, createDashboardLoader } from '../lib/filip.server.ts';
import { ageLabel, olderLocation, retainPrevious } from '../lib/types.ts';
import { dashboardResponse } from '../lib/api.server.ts';
import { demoData } from '../lib/demo.ts';

const tokens = { accessToken: 'fictional-token', refreshToken: 'fictional-refresh', expDate: '2099-01-01T00:00:00Z' };
const envelope = (data: unknown, status = 0) => Response.json({ status, data });
const watch = { id: 123, firstName: 'Example', hardwareName: 'JrTrack', batteryLevel: 82, externalBatteryLevel: 1, latitude: 43, longitude: -89, radius: 12, isValid: true, gpsDate: '2026-10-06T12:00:00Z', gsmNumber: 'PRIVATE-PHONE', imei: 'PRIVATE-IMEI', lastName: 'PRIVATE-SURNAME' };
function clientWith(handler: (path: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: { path: string; method: string; headers: Headers }[] = [];
    const client = new FilipClient('example@example.test', 'test-only-password', (async (url: string | URL | Request, init: RequestInit = {}) => {
        const path = String(url).replace('https://api.myfilip.com/v2', '');
        calls.push({ path, method: init.method!, headers: new Headers(init.headers) });
        assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
        assert.equal(init.cache, 'no-store');
        assert.equal(new Headers(init.headers).get('Accept'), 'application/json');
        assert.match(new Headers(init.headers).get('User-Agent')!, /^cosmo-family-dashboard\//);
        return handler(path, init);
    }) as typeof fetch);
    return { client, calls };
}
function resources(path: string) {
    if (path.startsWith('/token')) return envelope(tokens);
    if (path === '/map') return envelope({ Devices: [watch, { ...watch, id: 456, firstName: 'Second' }] });
    if (path.startsWith('/stepcounter/list/daily/simple/')) return envelope({ stepcount: [] });
    return envelope([]);
}
test('dashboard uses only allowed reads and auth, redacts unrelated personal fields', async () => {
    const { client, calls } = clientWith(resources), data = await fetchDashboard(client);
    assert.equal(data.watches.length, 2); assert.equal(data.watches[0].battery, 82);
    assert.equal(data.watches[0].steps, null); assert.equal(data.watches[0].goal, null);
    assert.equal(data.zonesState, 'empty'); assert.equal(data.schedulesState, 'empty');
    assert.equal(calls.length, 9);
    assert.deepEqual(calls.filter(c => c.method !== 'GET' && !c.path.startsWith('/stepcounter/list/daily/simple/')).map(c => c.path), ['/token']);
    for (const c of calls.filter(c => c.path !== '/token')) assert.equal(c.headers.get('Authorization'), 'Bearer fictional-token');
    assert.doesNotMatch(JSON.stringify(data), /PRIVATE|externalBattery|imei|gsmNumber|password|accessToken/);
    await assert.rejects(() => client.read('/map/refresh'), /Blocked/);
    await assert.rejects(() => client.read('/device/goals/123/../settings'), /Blocked/);
    await assert.rejects(() => client.read('https://evil.example/map'), /Blocked/);
});
for (const failure of ['http401', 'expired-envelope']) test(`retries ${failure} once without leaking auth to other hosts`, async () => {
    let reads = 0;
    const { client, calls } = clientWith(path => path.startsWith('/token') ? envelope(tokens) : ++reads === 1 ? failure === 'http401' ? new Response('', { status: 401 }) : envelope(null, 2) : envelope({ Devices: [] }));
    await client.read('/map'); assert.equal(reads, 2); assert.equal(calls.filter(c => c.path === '/token').length, 2);
});
test('stops after repeated authentication rejection', async () => {
    const { client, calls } = clientWith(path => path === '/token' ? envelope(tokens) : new Response('', { status: 401 }));
    await assert.rejects(() => client.read('/map')); assert.equal(calls.length, 4);
});
test('expired token uses refresh and falls back to login if refresh fails', async () => {
    let logins = 0;
    const { client, calls } = clientWith(path => {
        if (path === '/token') return envelope({ ...tokens, expDate: ++logins === 1 ? '2000-01-01T00:00:00Z' : tokens.expDate });
        if (path === '/token/refresh') return new Response('', { status: 401 });
        return envelope({ Devices: [] });
    });
    await client.read('/map'); await client.read('/map');
    assert.equal(calls.filter(c => c.path === '/token/refresh').length, 1); assert.equal(logins, 2);
});
for (const mode of ['http403','envelope403','malformed','timeout','redirect']) test(`handles ${mode} without authentication loops`, async () => {
    const { client, calls } = clientWith(path => {
        if (path === '/token') return envelope(tokens);
        if (mode === 'timeout') throw new DOMException('Timeout', 'TimeoutError');
        if (mode === 'malformed') return new Response('not json');
        if (mode === 'envelope403') return envelope(null, 403);
        return new Response('', { status: mode === 'redirect' ? 302 : 403 });
    });
    await assert.rejects(() => client.read('/map')); assert.equal(calls.length, 2);
});
test('coalesces concurrent authentication and dashboard loads; reuses short-lived cache', async () => {
    const { client, calls } = clientWith(async path => { await new Promise(resolve => setTimeout(resolve, 5)); return resources(path); });
    const load = createDashboardLoader(client), [a,b] = await Promise.all([load(),load()]);
    assert.equal(a,b); assert.equal(await load(),a); assert.equal(calls.length,9);
});
test('optional resource failure keeps map and labels unavailable section', async () => {
    const { client } = clientWith(path => path === '/safezones' ? new Response('', { status: 500 }) : resources(path));
    const data = await fetchDashboard(client); assert.equal(data.watches.length,2); assert.equal(data.zonesState,'unavailable'); assert.equal(data.schedulesState,'empty');
});
test('invalid coordinates and missing battery do not invent substitutes', () => {
    const data = normalizeWatches({ Devices: [{ ...watch, isValid: false }, { ...watch, id: 456, latitude: 91, batteryLevel: null }, { ...watch, id: 789, longitude: null }] });
    assert.ok(data.every(w => !w.location)); assert.equal(data[1].battery,null);
    assert.equal(normalizeWatches({ Devices: [{ ...watch, batteryLevel: 0 }] })[0].battery,0);
});
test('maps step report fields by watch ID, chooses latest record and preserves zero', () => {
    const records = normalizeSteps({ devices: [{ id:456, InfomarkStepcounters:[{count:0,startTime:'2026-10-06T00:00:00Z',endTime:'2026-10-06T12:00:00Z'},{count:10,startTime:'2026-10-05T00:00:00Z',endTime:'2026-10-05T12:00:00Z'}] }] });
    assert.equal(records.get('456')?.count,0); assert.equal(records.get('123'),undefined);
    assert.throws(() => normalizeSteps({ devices:[{ id:123,InfomarkStepcounters:[{ steps:100 }] }] }));
    assert.equal(normalizeGoal([]),null); assert.equal(normalizeGoal({stepGoal:6000}),6000); assert.equal(normalizeGoal({stepGoal:0}),0); assert.throws(() => normalizeGoal({unknown:1}));
});
test('daily report query is authenticated, bounded, retries auth, and cannot sync or edit a watch', async () => {
    let queries = 0;
    const { client, calls } = clientWith((path, init) => {
        if (path === '/token') return envelope(tokens);
        assert.equal(path, '/stepcounter/list/daily/simple/123');
        assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(String(init.body)), { startDate: '2026-10-01', endDate: '2026-10-07' });
        return ++queries === 1 ? new Response('', { status: 401 }) : envelope({ stepcount: [] });
    });
    await client.readDailySteps('123','2026-10-01','2026-10-07');
    assert.equal(queries,2);
    assert.ok(calls.filter(c=>c.path.includes('/daily/')).every(c=>c.headers.get('Authorization')==='Bearer fictional-token'));
    for (const args of [['../123','2026-10-01','2026-10-07'],['123','2026-02-30','2026-03-01'],['123','2026-10-07','2026-10-01'],['123','2026-01-01','2026-10-07']]) await assert.rejects(()=>client.readDailySteps(...args as [string,string,string]));
    await assert.rejects(()=>client.read('/stepcounter/report/123'), /Blocked/);
});
test('daily totals match COSMO watch-total preference, preserve zero, and reject malformed dates/counts', () => {
    const records = normalizeDailySteps({ stepcount: [
        {day:'2026-10-05',totalStep:900,totalStepOnWatch:800},
        {day:'2026-10-06',totalStep:900,totalStepOnWatch:0},
        {day:'2026-10-04',totalStep:700,totalStepOnWatch:null},
    ] });
    assert.deepEqual(records.map(r=>[r.day,r.count]),[['2026-10-06',0],['2026-10-05',800],['2026-10-04',700]]);
    assert.equal(normalizeDailySteps({stepcount:[{day:'2026-10-06',totalStepOnWatch:-1}]})[0].count,0);
    assert.equal(normalizeDailySteps({stepcount:[]}).length,0);
    for (const row of [{day:'2026-02-30',totalStep:1},{day:'bad',totalStep:1},{day:'2026-10-06',totalStep:1.5},{day:'2026-10-06',totalStep:'10'},{day:'2026-10-06'}]) assert.throws(()=>normalizeDailySteps({stepcount:[row]}));
});
test('collector uses app daily history when leaderboard is empty and isolates per-watch failure', async () => {
    const {client,calls}=clientWith(path=>path==='/stepcounter/list/daily/simple/123' ? envelope({stepcount:[{day:'2026-10-06',totalStep:100,totalStepOnWatch:1234}]}) : path==='/stepcounter/list/daily/simple/456' ? new Response('',{status:500}) : resources(path));
    const data=await fetchDashboard(client);
    assert.equal(data.watches[0].steps?.count,1234); assert.equal(data.watches[0].steps?.day,'2026-10-06'); assert.equal(data.watches[0].stepsState,'ok');
    assert.equal(data.watches[1].stepsState,'unavailable');
    assert.ok(!calls.some(c=>c.path==='/stepcounter'));
});
test('maps zone and schedule fields without unknown mode enums', () => {
    const z = normalizeZones([{Id:1,name:'Example place',latitude:'43.0',longitude:'-89.0',radius:200,enabled:true,devices:[{deviceId:123,enable:true},{deviceId:456,enable:false}]}]);
    assert.deepEqual(z[0].watchIds,['123']);
    const schedules = normalizeSchedules([{Id:2,title:'Learning',enabled:true,schoolMode:true,focusMode:false,time:28800,endTime:54000,devices:[{id:123}],weekDays:[false,true,true,true,true,true,false]}]);
    assert.equal(schedules[0].kind,'School mode'); assert.deepEqual(schedules[0].watchIds,['123']);
    assert.throws(() => normalizeZones([{Id:1,latitude:'',longitude:'-89',radius:1,enabled:true,devices:[]}]));
});
test('uses report time, not fetch time, for location age and one hour warning', () => {
    const location = normalizeWatches({Devices:[watch]})[0].location!;
    assert.equal(olderLocation(location,Date.parse(watch.gpsDate)+61*60000),true);
    assert.equal(olderLocation(location,Date.parse(watch.gpsDate)+60*60000),false);
    assert.equal(ageLabel(watch.gpsDate,Date.parse(watch.gpsDate)+16*60000),'16 min ago');
    assert.equal(ageLabel(null),'Report time unavailable');
});
test('preserves prior optional readings with explicit stale labels; does not preserve confirmed empty data', () => {
    const previous=demoData(), next={...previous,zones:[],zonesState:'unavailable' as const,watches:previous.watches.map(w=>({...w,steps:null,stepsState:'unavailable' as const}))};
    const data=retainPrevious(next,previous); assert.equal(data.zonesState,'stale'); assert.equal(data.watches[0].stepsState,'stale');
    assert.equal(retainPrevious({...next,zonesState:'empty'},previous).zones.length,0);
});
test('unauthenticated API cannot load data, responses are private and error text is sanitized', async () => {
    let loads=0;
    const unauthorized=await dashboardResponse(false,async()=>{loads++;return demoData();});
    assert.equal(unauthorized.status,401); assert.equal(loads,0);
    const success=await dashboardResponse(true,async()=>demoData()); assert.equal(success.headers.get('Cache-Control'),'private, no-store');
    const error=await dashboardResponse(true,async()=>{throw new Error('PRIVATE-CREDENTIAL');});
    assert.equal(error.status,502); assert.doesNotMatch(await error.text(),/PRIVATE/);
});
test('demo data is fictional and never includes numeric live watch IDs', () => {
    const demo=demoData(); assert.ok(demo.watches.every(w=>w.id.startsWith('demo-'))); assert.ok(demo.watches.every(w=>!!w.steps));
});


test('reported power uses only a boolean shutdown flag, independently of battery and status', () => {
    const records = [
        { ...watch, shutdown: false, batteryLevel: 0, status: 999 },
        { ...watch, shutdown: true, batteryLevel: 82, status: 1 },
        { ...watch, shutdown: null }, { ...watch },
        { ...watch, shutdown: 0 }, { ...watch, shutdown: 'false' },
    ];
    const normalized = normalizeWatches({ Devices: records });
    assert.deepEqual(normalized.map(w => w.powerState), ['on','off','unknown','unknown','unknown','unknown']);
    assert.equal(normalized[0].battery, 0);
    assert.equal(normalized[1].battery, 82);
    assert.ok(normalized[1].location, 'Powered-off watch retains its last-known location');
    assert.deepEqual(demoData().watches.map(w => w.powerState), ['on','off']);
});


test('uses observed JT5 hardware family for model and preserves explicit unknown versions', () => {
    const versions = ['JT5_DEMO', 'JT5', 'JT50_DEMO', 'UNKNOWN_DEMO', '', null, 5];
    const watches = normalizeWatches({ Devices: versions.map(hardwareVersion => ({ ...watch, hardwareName: 'watch', hardwareVersion })) });
    assert.deepEqual(watches.map(w => w.model), ['JrTrack 5','JrTrack 5','COSMO watch','COSMO watch','COSMO watch','COSMO watch','COSMO watch']);
    assert.equal(watches[0].hardwareVersion, 'JT5_DEMO');
    assert.equal(watches[3].hardwareVersion, 'UNKNOWN_DEMO');
    assert.ok(watches.slice(4).every(w => w.hardwareVersion === null));
    assert.equal(normalizeWatches({ Devices: [{ ...watch, hardwareVersion: null }] })[0].model, 'JrTrack');
});


test('normalizes notification text, timestamps, associations and read flags without raw personal fields', () => {
    const watches = normalizeWatches({Devices:[watch]});
    const notification = {id:1, deviceId:123, created:'2026-10-06T12:00:00Z', translated:'Example arrived at School.', description:'NOTIFICATION_NEW_LOC', read:false, deleted:false, userId:'PRIVATE-USER', additionalData:{phone:'PRIVATE-PHONE'}, arguments:['PRIVATE-ARGUMENT'], gpsDate:'PRIVATE-GPS', zoneId:'PRIVATE-ZONE'};
    const records = normalizeNotifications([notification,{...notification,id:2,deviceId:999,created:null,translated:'',description:'NOTIFICATION_UNKNOWN',read:null},{...notification,id:3,deleted:true}],watches);
    assert.equal(records.length,2);
    assert.deepEqual(records[0],{id:'1',watchId:'123',createdAt:'2026-10-06T12:00:00.000Z',body:'Example arrived at School.',read:false});
    assert.equal(records[1].watchId,null); assert.equal(records[1].createdAt,null); assert.equal(records[1].read,null); assert.equal(records[1].body,'Notification details unavailable');
    assert.doesNotMatch(JSON.stringify(records),/PRIVATE|additionalData|arguments|zoneId|userId|gpsDate/);
    assert.throws(()=>normalizeNotifications({items:[]},watches));
    assert.throws(()=>normalizeNotifications([{...notification,id:null}],watches));
});

test('sorts and bounds notifications, deduplicates newest record, and escapes text through plain strings', () => {
    const input = Array.from({length:105},(_,i)=>({id:i,created:new Date(2026,0,1,0,i).toISOString(),translated:'<b>Example</b>',read:true}));
    input.push({...input[104],created:'2020-01-01T00:00:00Z',translated:'Old duplicate'});
    const records=normalizeNotifications(input,[]);
    assert.equal(records.length,100); assert.equal(records[0].id,'104'); assert.equal(records[0].body,'<b>Example</b>');
    assert.equal(records.at(-1)?.id,'5');
});

test('notification failure is isolated; retained history is stale and confirmed empty clears it', async () => {
    const {client,calls}=clientWith(path=>path==='/eventlogs'?new Response('',{status:500}):resources(path));
    const next=await fetchDashboard(client);
    assert.equal(next.notificationsState,'unavailable'); assert.equal(next.watches.length,2);
    const previous=demoData(), retained=retainPrevious(next,previous);
    assert.equal(retained.notificationsState,'stale'); assert.deepEqual(retained.notifications,previous.notifications);
    assert.equal(retainPrevious({...next,notificationsState:'empty'},previous).notifications.length,0);
    assert.ok(calls.filter(c=>c.path==='/eventlogs').every(c=>c.method==='GET'));
    await assert.rejects(()=>client.read('/eventlogs/count')); await assert.rejects(()=>client.read('/push/register/fcm'));
});
