import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionItems, placeLabel, timelineEvents } from '../lib/insights.ts';
import type { DashboardData, Watch, Zone } from '../lib/types.ts';
import type { HistoryRecord } from '../lib/history.ts';

const at = '2026-10-06T12:00:00.000Z';
const watch: Watch = { id: '1', name: 'Sample', model: 'JrTrack 5', hardwareVersion: null, battery: 19, powerState: 'off', location: { latitude: 43, longitude: -89, radius: 10, reportedAt: at }, steps: null, goal: null, stepsState: 'empty', goalState: 'empty' };
const zone: Zone = { id: '2', name: 'School', enabled: true, latitude: 43, longitude: -89, radius: 100, watchIds: ['1'] };
const data: DashboardData = { fetchedAt: at, watches: [watch], zones: [zone], schedules: [], notifications: [], zonesState: 'ok', schedulesState: 'empty', notificationsState: 'empty' };

test('attention uses last report values and the location report clock', () => {
    assert.deepEqual(attentionItems(data, Date.parse(at) + 61 * 60_000).map(item => item.title), ['Sample: reported off', 'Sample: 19% battery', 'Sample: older location']);
    assert.equal(attentionItems({ ...data, watches: [{ ...watch, battery: 80, powerState: 'on' }] }, Date.parse(at) + 60 * 60_000).length, 0);
});

test('routine 15 and 30 minute intervals do not need attention; missing report times remain explicit', () => {
    const healthy = { ...data, watches: [{ ...watch, battery: 80, powerState: 'on' as const }] };
    for (const minutes of [15,16,30,59,60]) assert.deepEqual(attentionItems(healthy,Date.parse(at)+minutes*60_000),[]);
    assert.equal(attentionItems(healthy,Date.parse(at)+61*60_000)[0].detail,'No location report in over an hour');
    const unknown = { ...healthy, watches: [{ ...healthy.watches[0], location: { ...watch.location!, reportedAt:null } }] };
    assert.equal(attentionItems(unknown,Date.parse(at))[0].detail,'Report time unavailable');
});

test('place labels honor assignments, enabled state, and uncertain boundaries', () => {
    assert.equal(placeLabel(watch, [zone], 'ok'), 'Within School · approximate');
    assert.equal(placeLabel({ ...watch, location: { ...watch.location!, radius: 120 } }, [zone], 'ok'), 'Near School boundary · uncertain');
    assert.equal(placeLabel(watch, [{ ...zone, enabled: false }], 'ok'), null);
    assert.equal(placeLabel(watch, [zone], 'stale'), null);
    assert.equal(placeLabel({ ...watch, id: '3' }, [zone], 'ok'), null);
});

test('combined timeline includes saved events and only meaningful reading changes', () => {
    const rows: HistoryRecord[] = [
        { id: 'a', kind: 'watch-readings', watchId: '1', recordedAt: '2026-10-06T11:00:00.000Z', collectedAt: at, payload: { ...watch, battery: 24, powerState: 'on' } },
        { id: 'b', kind: 'watch-readings', watchId: '1', recordedAt: '2026-10-06T11:05:00.000Z', collectedAt: at, payload: { ...watch, battery: 19, powerState: 'off' } },
        { id: 'c', kind: 'locations', watchId: '1', recordedAt: at, collectedAt: at, payload: watch.location! },
        { id: 'd', kind: 'notifications', watchId: '1', recordedAt: at, collectedAt: at, payload: { id: 'd', watchId: '1', createdAt: at, body: 'Test notice', read: false } },
    ];
    const events = timelineEvents(rows);
    assert.deepEqual(events.map(e => e.title).sort(), ['Battery reported at 19%', 'Location report', 'Notification', 'Power reported off']);
    assert.equal(events.find(e => e.title === 'Location report')?.locationId, 'c');
});
