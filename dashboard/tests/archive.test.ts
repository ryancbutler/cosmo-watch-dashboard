import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { collectArchive, readDashboard, readHistory } from '../lib/archive.server.ts';
import { parseHistoryQuery, localDateBounds } from '../lib/history.ts';
import { fetchCollection, FilipClient } from '../lib/filip.server.ts';
import type { CollectedData } from '../lib/filip.server.ts';
import type { Watch } from '../lib/types.ts';

const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test") } }', d1Databases: { DB: 'archive-test' }, compatibilityDate: '2026-05-15' });
after(async () => { await mf.dispose(); });
const watch: Watch = { id: '123', name: 'Fictional', model: 'COSMO watch', hardwareVersion: null, battery: 80, powerState: 'on', location: { latitude: 43, longitude: -89, radius: 12, reportedAt: '2026-10-06T12:00:00.000Z' }, steps: null, goal: null, stepsState: 'empty', goalState: 'empty' };
function fixture(at = new Date().toISOString()): CollectedData {
    return { dashboard: { fetchedAt: at, watches: [structuredClone(watch)], zones: [], schedules: [], notifications: [], zonesState: 'empty', schedulesState: 'empty', notificationsState: 'empty' }, stepReports: new Map(), notifications: [] };
}
async function database() {
    const db = await mf.getD1Database('DB') as unknown as D1Database;
    const tables = ['history_records', 'dashboard_snapshots', 'collection_runs', 'collection_lease', 'watch_catalog'];
    for (const table of tables) await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    const folder = new URL('../drizzle/', import.meta.url);
    for (const file of readdirSync(folder).filter(f => f.endsWith('.sql')).sort()) {
        for (const sql of readFileSync(new URL(file, folder), 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
    }
    return db;
}
const query = (kind = 'locations', extras: Record<string, string> = {}) => {
    const params = new URLSearchParams({ kind, watchId: '123', from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z', ...extras });
    if (extras.watchId === '') params.delete('watchId');
    return parseHistoryQuery(params);
};

test('migrations create a usable D1 archive; repeated reports dedupe while stationary new reports persist', async () => {
    const db = await database(), now = Date.now();
    assert.equal((await readDashboard(db)).collection?.status, 'never');
    assert.equal((await collectArchive(db, async () => fixture(), now)).status, 'ok');
    assert.equal((await collectArchive(db, async () => { throw new Error('should not fetch'); }, now)).status, 'already-collected');
    assert.equal((await collectArchive(db, async () => fixture(new Date(now + 300_000).toISOString()), now + 300_000)).status, 'ok');
    assert.equal((await readHistory(db, query())).records.length, 1);
    const newer = fixture(new Date(now + 600_000).toISOString()); newer.dashboard.watches[0].location!.reportedAt = '2026-10-06T12:05:00.000Z';
    await collectArchive(db, async () => newer, now + 600_000);
    assert.equal((await readHistory(db, query())).records.length, 2);
    assert.equal((await readDashboard(db)).historyWatches?.[0].id, '123');
});
test('missing report times save consecutive changes and preserve explicitly unknown time', async () => {
    const db = await database(), now = Date.now();
    for (let i = 0; i < 3; i++) {
        const data = fixture(new Date(now + i * 300_000).toISOString()); data.dashboard.watches[0].location!.reportedAt = null;
        if (i === 2) data.dashboard.watches[0].location!.latitude = 44;
        await collectArchive(db, async () => data, now + i * 300_000);
    }
    const rows = await readHistory(db, query()); assert.equal(rows.records.length, 2);
    assert.equal((rows.records[0].payload as { reportedAt: null }).reportedAt, null);
    assert.equal(rows.records[0].recordedAt, rows.records[0].collectedAt);
});

test('overview matches latest history when upstream location regresses and preserves fresh battery readings', async () => {
    const db = await database(), now = Date.now();
    const newer = fixture(new Date(now).toISOString());
    newer.dashboard.watches[0].location = { latitude: 44, longitude: -88, radius: 20, reportedAt: '2026-10-06T13:00:00.000Z' };
    await collectArchive(db, async () => newer, now);
    const regressed = fixture(new Date(now + 300_000).toISOString());
    regressed.dashboard.watches[0].battery = 61;
    await collectArchive(db, async () => regressed, now + 300_000);
    const dashboard = await readDashboard(db), history = await readHistory(db, query());
    assert.deepEqual(dashboard.watches[0].location, history.records[0].payload);
    assert.equal(dashboard.watches[0].battery,61);
    assert.equal(dashboard.fetchedAt,regressed.dashboard.fetchedAt);
    const missing = fixture(new Date(now + 600_000).toISOString());
    missing.dashboard.watches[0].location = null;
    await collectArchive(db, async () => missing, now + 600_000);
    assert.deepEqual((await readDashboard(db)).watches[0].location,newer.dashboard.watches[0].location);
    const fresh = fixture(new Date(now + 900_000).toISOString());
    fresh.dashboard.watches[0].location = { latitude: 45, longitude: -87, radius: 15, reportedAt: '2026-10-06T14:00:00.000Z' };
    await collectArchive(db, async () => fresh, now + 900_000);
    assert.deepEqual((await readDashboard(db)).watches[0].location,fresh.dashboard.watches[0].location);
    const removed = fixture(new Date(now + 1200_000).toISOString()); removed.dashboard.watches = [];
    await collectArchive(db, async () => removed, now + 1200_000);
    assert.equal((await readDashboard(db)).watches.length,0);
});
test('optional failures retain stale data, successful empty clears current state but preserves archive', async () => {
    const db = await database(), now = Date.now(), first = fixture();
    first.dashboard.zones = [{ id: '789', name: 'Fictional home', enabled: true, latitude: 43, longitude: -89, radius: 100, watchIds: ['123'] }]; first.dashboard.zonesState = 'ok';
    await collectArchive(db, async () => first, now);
    const failed = fixture(new Date(now + 300_000).toISOString()); failed.dashboard.zonesState = 'unavailable';
    assert.equal((await collectArchive(db, async () => failed, now + 300_000)).status, 'partial');
    assert.equal((await readDashboard(db)).zonesState, 'stale');
    await collectArchive(db, async () => fixture(new Date(now + 600_000).toISOString()), now + 600_000);
    assert.equal((await readDashboard(db)).zones.length, 0);
    assert.equal((await readHistory(db, query('zones', { watchId: '' }))).records.length, 2);
});
test('overlap skips upstream fetch; authentication failure leaves snapshot readable and logs no secrets', async () => {
    const db = await database(), now = Date.now();
    await collectArchive(db, async () => fixture(), now);
    await db.prepare('INSERT INTO collection_lease VALUES (1, ?, ?)').bind('other', now + 900_000).run();
    assert.equal((await collectArchive(db, async () => { throw new Error('must not fetch'); }, now + 300_000)).status, 'busy');
    await db.prepare('DELETE FROM collection_lease').run();
    assert.equal((await collectArchive(db, async () => { throw new Error('PRIVATE-TOKEN PRIVATE-LOCATION'); }, now + 300_000)).status, 'failed');
    const dashboard = await readDashboard(db); assert.equal(dashboard.watches.length, 1); assert.equal(dashboard.collection?.status, 'failed');
    const runs = await db.prepare('SELECT * FROM collection_runs').all(); assert.doesNotMatch(JSON.stringify(runs), /PRIVATE/);
});
test('database failure rolls back snapshot, catalog, and all history; lease recovery can retry', async () => {
    const db = await database(), now = Date.now();
    await db.prepare("CREATE TRIGGER reject_history BEFORE INSERT ON history_records BEGIN SELECT RAISE(ABORT, 'test'); END").run();
    assert.equal((await collectArchive(db, async () => fixture(), now)).status, 'failed');
    assert.equal((await readDashboard(db)).watches.length, 0);
    assert.equal((await readHistory(db, query())).records.length, 0);
    await db.prepare('DROP TRIGGER reject_history').run();
    assert.equal((await collectArchive(db, async () => fixture(), now)).status, 'ok');
});
test('lost lease cannot commit a fetched snapshot', async () => {
    const db = await database();
    assert.equal((await collectArchive(db, async () => { await db.prepare("UPDATE collection_lease SET holder='other'").run(); return fixture(); })).status, 'failed');
    assert.equal((await readDashboard(db)).watches.length, 0);
});
test('archive retains all step reports and notifications beyond the latest dashboard display limit', async () => {
    const db = await database();
    const sourceWatch = { id: 123, firstName: 'Fictional', isValid: false };
    const reports = [{ day: '2026-10-05', totalStepOnWatch: 20 }, { day: '2026-10-06', totalStepOnWatch: 30 }];
    const notifications = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, deviceId: 123, created: '2026-10-06T12:00:00Z', description: 'Fictional notice', read: true }));
    const client = new FilipClient('fictional@example.test', 'fictional-password', (async url => {
        const path = String(url).split('/v2')[1];
        const data = path === '/token' ? { accessToken: 'fictional', expDate: '2099-01-01T00:00:00Z' } : path === '/map' ? { Devices: [sourceWatch] } : path === '/stepcounter/list/daily/simple/123' ? { stepcount: reports } : path === '/eventlogs' ? notifications : [];
        return Response.json({ status: 0, data });
    }) as typeof fetch);
    const collected = await fetchCollection(client); assert.equal(collected.dashboard.notifications.length, 100); assert.equal(collected.notifications.length, 120);
    await collectArchive(db, async () => collected);
    assert.equal((await readHistory(db, query('notifications'))).records.length, 120);
    assert.equal((await readHistory(db, query('steps'))).records.length, 2);
    reports[1].totalStepOnWatch = 45;
    const corrected = await fetchCollection(client);
    await collectArchive(db, async () => corrected, Date.now()+300_000);
    const saved = await readHistory(db, query('steps'));
    assert.equal(saved.records.length,2);
    assert.equal((saved.records[0].payload as {count:number}).count,45);
});
test('history pagination is stable across equal timestamps, scoped to filters, and rejects bad requests', async () => {
    const db = await database(), data = fixture();
    data.notifications = Array.from({ length: 3 }, (_, i) => ({ id: String(i), watchId: '123', createdAt: '2026-10-06T12:00:00.000Z', body: 'Fictional', read: null }));
    await collectArchive(db, async () => data);
    const first = await readHistory(db, query('notifications', { limit: '2' })); assert.equal(first.records.length, 2); assert.ok(first.nextCursor);
    const second = await readHistory(db, query('notifications', { limit: '2', cursor: first.nextCursor! })); assert.equal(second.records.length, 1); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.records, ...second.records].map(r => r.id)).size, 3);
    assert.throws(() => query('steps', { cursor: first.nextCursor! }), /cursor/);
    const invalid: Record<string, string>[] = [{ watchId: '../123' }, { limit: '201' }, { cursor: 'bad' }, { to: '2027-01-01T00:00:00Z' }, { from: '2026-02-30T00:00:00Z' }];
    for (const extra of invalid) assert.throws(() => query('locations', extra));
    assert.throws(() => query('raw')); assert.throws(() => query('locations', { watchId: '' }));
    assert.ok(localDateBounds('2026-10-06', '2026-10-06').from.endsWith('Z'));
});
