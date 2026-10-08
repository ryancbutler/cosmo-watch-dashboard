import type { Location, StepRecord, Watch, WatchNotification, Zone, Schedule, Availability } from './types.ts';

export const historyKinds = ['locations', 'watch-readings', 'steps', 'notifications', 'zones', 'schedules'] as const;
export type HistoryKind = typeof historyKinds[number];
export type HistoryPayload = Location | Watch | StepRecord | WatchNotification | { state: Availability; items: Zone[] | Schedule[] };
export type HistoryRecord = { id: string; kind: HistoryKind; watchId: string; recordedAt: string; collectedAt: string; payload: HistoryPayload };
export type HistoryPage = { records: HistoryRecord[]; nextCursor: string | null };
export type HistoryQuery = { kind: HistoryKind; watchId: string | null; from: string; to: string; limit: number; cursor: { at: string; id: string } | null };

export function parseHistoryQuery(params: URLSearchParams): HistoryQuery {
    const kind = params.get('kind') as HistoryKind;
    if (!historyKinds.includes(kind)) throw new Error('Choose a valid history kind.');
    const watchId = params.get('watchId');
    if (watchId !== null && !/^\d{1,30}$/.test(watchId)) throw new Error('Invalid watch ID.');
    if (['locations', 'watch-readings', 'steps'].includes(kind) && !watchId) throw new Error('Choose a watch.');
    const parseDate = (value: string | null) => {
        if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Use valid UTC date bounds.');
        const normalized = new Date(value).toISOString();
        if (normalized !== (value.includes('.') ? value : value.replace('Z', '.000Z'))) throw new Error('Use valid UTC date bounds.');
        return normalized;
    };
    const from = parseDate(params.get('from')), to = parseDate(params.get('to'));
    if (to <= from || Date.parse(to) - Date.parse(from) > 31 * 86400_000) throw new Error('Choose a range of up to 31 days.');
    const rawLimit = params.get('limit') ?? '200';
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200) throw new Error('Limit must be between 1 and 200.');
    let cursor: HistoryQuery['cursor'] = null;
    const rawCursor = params.get('cursor');
    if (rawCursor) {
        try {
            if (rawCursor.length > 2000) throw new Error();
            const c = JSON.parse(atob(rawCursor));
            if (typeof c.id !== 'string' || c.id.length > 500 || !c.id || c.kind !== kind || c.watchId !== watchId || c.from !== from || c.to !== to) throw new Error();
            cursor = { at: parseDate(c.at), id: c.id };
        } catch { throw new Error('Invalid history cursor.'); }
    }
    return { kind, watchId, from, to, limit: Number(rawLimit), cursor };
}
export function historyCursor(query: HistoryQuery, record: HistoryRecord): string {
    return btoa(JSON.stringify({ kind: query.kind, watchId: query.watchId, from: query.from, to: query.to, at: record.recordedAt, id: record.id }));
}

// Dates entered in the browser describe the viewer's local calendar, including DST.
export function localDateBounds(first: string, last: string): { from: string; to: string } {
    const from = new Date(`${first}T00:00:00`), to = new Date(`${last}T00:00:00`);
    to.setDate(to.getDate() + 1);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw new Error('Choose a valid date range.');
    if (to.getTime() - from.getTime() > 31 * 86400_000) throw new Error('Choose a range of up to 31 days.');
    return { from: from.toISOString(), to: to.toISOString() };
}
