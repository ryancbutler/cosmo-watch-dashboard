import type { DashboardData, CollectionStatus, Watch, Location } from './types.ts';
import { retainPrevious } from './types.ts';
import type { CollectedData } from './filip.server.ts';
import type { HistoryKind, HistoryRecord, HistoryQuery, HistoryPage } from './history.ts';
import { historyCursor } from './history.ts';

type StoredSnapshot = { collected_at: string; payload: string };
const decode = (row: StoredSnapshot | null): DashboardData | null => row ? JSON.parse(row.payload) : null;
async function latestSnapshot(db: D1Database): Promise<DashboardData | null> {
    return decode(await db.prepare('SELECT collected_at, payload FROM dashboard_snapshots ORDER BY collected_at DESC, id DESC LIMIT 1').first<StoredSnapshot>());
}
export async function readDashboard(db: D1Database, now = Date.now()): Promise<DashboardData> {
    const [data, run, first, catalog] = await Promise.all([
        latestSnapshot(db),
        db.prepare('SELECT started_at, status FROM collection_runs ORDER BY started_at DESC LIMIT 1').first<{ started_at: string; status: string }>(),
        db.prepare('SELECT MIN(collected_at) AS at FROM dashboard_snapshots').first<{ at: string | null }>(),
        db.prepare('SELECT payload FROM watch_catalog ORDER BY id').all<{ payload: string }>(),
    ]);
    const status: CollectionStatus['status'] = !run ? 'never' : run.status === 'running' && now - Date.parse(run.started_at) > 180_000 ? 'failed' : run.status as CollectionStatus['status'];
    const collection: CollectionStatus = { lastAttempt: run?.started_at ?? null, lastSuccess: data?.fetchedAt ?? null, status, historyStartedAt: first?.at ?? null };
    // The upstream map can repeat an older report after a newer one was archived.
    // Use the same report ordering as history, scoped to currently paired watches.
    const watches = await Promise.all((data?.watches ?? []).map(async watch => {
        const latest = await db.prepare("SELECT payload, recorded_at, collected_at FROM history_records WHERE kind='locations' AND watch_id=? ORDER BY recorded_at DESC, id DESC LIMIT 1").bind(watch.id).first<{ payload: string; recorded_at: string; collected_at: string }>();
        if (!latest) return watch;
        const location = JSON.parse(latest.payload) as Location;
        const currentTime = watch.location?.reportedAt ? Date.parse(watch.location.reportedAt) : data ? Date.parse(data.fetchedAt) : -Infinity;
        return !watch.location || Date.parse(latest.recorded_at) >= currentTime ? { ...watch, location } : watch;
    }));
    return { ...(data ?? { fetchedAt: new Date(now).toISOString(), watches: [], zones: [], schedules: [], notifications: [], zonesState: 'empty', schedulesState: 'empty', notificationsState: 'empty' }), watches, collection, historyWatches: catalog.results.map(row => JSON.parse(row.payload) as Watch) };
}

export async function readHistory(db: D1Database, query: HistoryQuery): Promise<HistoryPage> {
    const conditions = ['kind = ?', 'recorded_at >= ?', 'recorded_at < ?'];
    const values: (string | number)[] = [query.kind, query.from, query.to];
    if (query.watchId) { conditions.push('watch_id = ?'); values.push(query.watchId); }
    if (query.cursor) { conditions.push('(recorded_at < ? OR (recorded_at = ? AND id < ?))'); values.push(query.cursor.at, query.cursor.at, query.cursor.id); }
    values.push(query.limit + 1);
    const result = await db.prepare(`SELECT id, kind, watch_id, recorded_at, collected_at, payload FROM history_records WHERE ${conditions.join(' AND ')} ORDER BY recorded_at DESC, id DESC LIMIT ?`).bind(...values).all<{ id: string; kind: HistoryKind; watch_id: string; recorded_at: string; collected_at: string; payload: string }>();
    const records: HistoryRecord[] = result.results.slice(0, query.limit).map(row => ({ id: row.id, kind: row.kind, watchId: row.watch_id, recordedAt: row.recorded_at, collectedAt: row.collected_at, payload: JSON.parse(row.payload) }));
    return { records, nextCursor: result.results.length > query.limit ? historyCursor(query, records[records.length - 1]) : null };
}

async function digest(value: unknown): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('');
}
export async function archiveRecords(collected: CollectedData, previous: DashboardData | null, runId: string): Promise<HistoryRecord[]> {
    const data = collected.dashboard, records: HistoryRecord[] = [], at = data.fetchedAt;
    const add = (id: string, kind: HistoryKind, watchId: string, recordedAt: string, payload: HistoryRecord['payload']) => records.push({ id, kind, watchId, recordedAt, collectedAt: at, payload });
    for (const watch of data.watches) {
        add(`${runId}:${watch.id}`, 'watch-readings', watch.id, at, watch);
        if (watch.location) {
            const old = previous?.watches.find(w => w.id === watch.id)?.location;
            if (watch.location.reportedAt || JSON.stringify(old) !== JSON.stringify(watch.location)) {
                const key = await digest([watch.id, watch.location, watch.location.reportedAt ? null : runId]);
                add(`location:${key}`, 'locations', watch.id, watch.location.reportedAt ?? at, watch.location);
            }
        }
        for (const report of collected.stepReports.get(watch.id) ?? []) {
            add(`steps:${watch.id}:${report.start}:${report.end}`, 'steps', watch.id, report.end, report);
        }
    }
    for (const n of collected.notifications) add(`notice:${n.id}`, 'notifications', n.watchId ?? '', n.createdAt ?? at, n);
    for (const kind of ['zones', 'schedules'] as const) {
        const state = data[kind === 'zones' ? 'zonesState' : 'schedulesState'];
        if (state === 'unavailable') continue;
        if (!previous || JSON.stringify(previous[kind]) !== JSON.stringify(data[kind])) add(`${kind}:${runId}`, kind, '', at, { state, items: data[kind] });
    }
    return records;
}

export type CollectionResult = { status: 'ok' | 'partial' | 'failed' | 'busy' | 'already-collected'; records?: number };
export async function collectArchive(db: D1Database, fetcher: () => Promise<CollectedData>, now = Date.now()): Promise<CollectionResult> {
    const holder = crypto.randomUUID(), startedAt = new Date(now).toISOString();
    const runId = new Date(Math.floor(now / 300_000) * 300_000).toISOString();
    const lease = await db.prepare('INSERT INTO collection_lease (id, holder, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET holder=excluded.holder, expires_at=excluded.expires_at WHERE collection_lease.expires_at <= ?').bind(holder, now + 180_000, now).run();
    if (!lease.meta.changes) return { status: 'busy' };
    const release = () => db.prepare('DELETE FROM collection_lease WHERE id=1 AND holder=?').bind(holder);
    try {
        const oldRun = await db.prepare('SELECT status FROM collection_runs WHERE id=?').bind(runId).first<{ status: string }>();
        if (oldRun && ['ok', 'partial'].includes(oldRun.status)) { await release().run(); return { status: 'already-collected' }; }
        await db.prepare("INSERT INTO collection_runs(id, started_at, status) VALUES (?, ?, 'running') ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at, finished_at=NULL, status='running', error=NULL").bind(runId, startedAt).run();
        const previous = await latestSnapshot(db), collected = await fetcher();
        const raw = collected.dashboard;
        const status = [raw.zonesState, raw.schedulesState, raw.notificationsState, ...raw.watches.flatMap(w => [w.stepsState, w.goalState])].includes('unavailable') ? 'partial' : 'ok';
        const records = await archiveRecords(collected, previous, runId), snapshot = retainPrevious(raw, previous);
        const active = await db.prepare('SELECT holder FROM collection_lease WHERE id=1 AND holder=? AND expires_at>?').bind(holder, Date.now()).first();
        if (!active) throw new Error('Lease expired');
        const encoded = records.map(r => ({ id: r.id, kind: r.kind, watch_id: r.watchId, recorded_at: r.recordedAt, collected_at: r.collectedAt, payload: JSON.stringify(r.payload) }));
        // All archive records, snapshot, run completion, and lease release commit together.
        await db.batch([
            // The NOT NULL payload is also an atomic fence against an expired/stolen lease.
            db.prepare('INSERT INTO dashboard_snapshots(id,collected_at,payload) VALUES (?,?, CASE WHEN EXISTS (SELECT 1 FROM collection_lease WHERE id=1 AND holder=? AND expires_at>?) THEN ? ELSE NULL END)').bind(runId, raw.fetchedAt, holder, Date.now(), JSON.stringify(snapshot)),
            db.prepare(`INSERT INTO history_records(id,kind,watch_id,recorded_at,collected_at,payload)
                SELECT json_extract(value,'$.id'),json_extract(value,'$.kind'),json_extract(value,'$.watch_id'),json_extract(value,'$.recorded_at'),json_extract(value,'$.collected_at'),json_extract(value,'$.payload') FROM json_each(?) WHERE true
                ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).bind(JSON.stringify(encoded)),
            db.prepare("INSERT INTO watch_catalog(id,last_seen,payload) SELECT json_extract(value,'$.id'),?,value FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,payload=excluded.payload").bind(raw.fetchedAt, JSON.stringify(raw.watches)),
            db.prepare('UPDATE collection_runs SET finished_at=?, status=? WHERE id=?').bind(raw.fetchedAt, status, runId), release(),
        ]);
        return { status, records: records.length };
    } catch {
        // Never store upstream error messages: they may contain personal data or secrets.
        await db.batch([db.prepare("UPDATE collection_runs SET finished_at=?, status='failed', error='Collection failed' WHERE id=? AND status='running' AND EXISTS (SELECT 1 FROM collection_lease WHERE id=1 AND holder=?)").bind(new Date().toISOString(), runId, holder), release()]);
        return { status: 'failed' };
    }
}
