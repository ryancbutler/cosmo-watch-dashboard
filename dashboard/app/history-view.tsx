'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import WatchMap from './watch-map';
import StepsPanel from './steps-panel';
import { localDateBounds, historyKinds } from '../lib/history';
import type { HistoryKind, HistoryPage, HistoryRecord } from '../lib/history';
import type { Watch, Location, StepRecord, WatchNotification, Zone, Schedule, CollectionStatus } from '../lib/types';
import { stepDayLabel } from '../lib/types';

const labels: Record<HistoryKind, string> = { locations: 'Locations', 'watch-readings': 'Battery & power', steps: 'Steps', notifications: 'Notifications', zones: 'Safe zones', schedules: 'Schedules' };
const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const time = (date: string) => new Date(date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const power = (watch: Watch) => watch.powerState === 'on' ? 'Powered on' : watch.powerState === 'off' ? 'Powered off' : 'Power unknown';

export default function HistoryView({ watches, selectedWatch, collection, revision, demo = false }: { watches: Watch[]; selectedWatch?: string; collection?: CollectionStatus; revision?: string; demo?: boolean }) {
    const [kind, setKind] = useState<HistoryKind>('locations');
    const [expanded, setExpanded] = useState(false);
    const [watchId, setWatchId] = useState(selectedWatch ?? watches[0]?.id ?? '');
    const [first, setFirst] = useState(''), [last, setLast] = useState('');
    const [page, setPage] = useState<HistoryPage>({ records: [], nextCursor: null });
    const [active, setActive] = useState<string | null>(null), [fitKey, setFitKey] = useState(0);
    const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const controller = useRef<AbortController | null>(null);
    const configuration = kind === 'zones' || kind === 'schedules';
    const records = page.records.filter(r => r.kind === kind && (configuration || r.watchId === watchId));
    useEffect(() => { const today = localDay(new Date()); setFirst(today); setLast(today); }, []);
    useEffect(() => { if (selectedWatch) setWatchId(selectedWatch); }, [selectedWatch]);
    useEffect(() => { if (!watchId && watches[0]) setWatchId(watches[0].id); }, [watches, watchId]);

    async function load(cursor: string | null, signal: AbortSignal) {
        if (!first || !last) return;
        if (kind === 'steps') { setLoading(false); setError(null); return; }
        if (!configuration && !watchId) { setPage({ records: [], nextCursor: null }); return; }
        setLoading(true); setError(null);
        try {
            const bounds = localDateBounds(first, last);
            const params = new URLSearchParams({ kind, ...bounds, limit: '200' });
            if (!configuration) params.set('watchId', watchId);
            if (cursor) params.set('cursor', cursor);
            let next: HistoryPage;
            if (demo) {
                const { demoHistory } = await import('../lib/demo-history');
                next = { records: demoHistory(kind, watches.find(w => w.id === watchId) ?? watches[0], bounds), nextCursor: null };
            } else {
                const response = await fetch(`/api/history?${params}`, { cache: 'no-store', signal });
                const body = await response.json() as HistoryPage & { error?: string };
                if (!response.ok) throw new Error(body.error ?? 'History is unavailable.');
                next = body;
            }
            if (signal.aborted) return;
            setPage(old => ({ records: cursor ? [...old.records, ...next.records.filter((r: HistoryRecord) => !old.records.some(o => o.id === r.id))] : next.records, nextCursor: next.nextCursor }));
            if (!cursor) setActive(next.records[0]?.id ?? null);
            setFitKey(v => v + 1);
        } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'History is unavailable.'); }
        finally { if (!signal.aborted) setLoading(false); }
    }
    useEffect(() => {
        controller.current?.abort();
        if (!expanded) { setLoading(false); return; }
        const request = new AbortController(); controller.current = request;
        setPage({ records: [], nextCursor: null }); setActive(null);
        void load(null, request.signal);
        return () => request.abort();
        // The query is defined by these filters. Watches provide names, not a fetch trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expanded, kind, watchId, first, last, revision, demo, retry]);
    const chosen = records.find(r => r.id === active), watch = watches.find(w => w.id === watchId);
    const mapWatch = chosen && watch ? [{ ...watch, location: chosen.payload as Location }] : [];
    return <section className="panel history-panel" id="history" aria-labelledby="history-heading">
        <div className="panel-heading"><div><h2 id="history-heading"><History size={20} /> Saved history</h2><p>Browse reports collected while the dashboard is closed.</p></div><button className="collapse-button" type="button" aria-expanded={expanded} aria-controls="history-content" onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide history' : 'Show history'}<ChevronDown size={17} className={expanded ? 'expanded' : ''} /></button></div>
        {expanded && <div id="history-content">
        <div className="history-filters">
            <label>History<select value={kind} onChange={e => {setKind(e.target.value as HistoryKind);if(e.target.value==='steps'){const date=new Date();setLast(localDay(date));date.setDate(date.getDate()-29);setFirst(localDay(date));}}}>{historyKinds.map(k => <option key={k} value={k}>{labels[k]}</option>)}</select></label>
            {!configuration && kind !== 'steps' && <label>Watch<select value={watchId} onChange={e => setWatchId(e.target.value)}>{watches.map(w => <option value={w.id} key={w.id}>{w.name}</option>)}</select></label>}
            <label>From<input type="date" value={first} onChange={e => setFirst(e.target.value)} /></label>
            <label>Through<input type="date" value={last} onChange={e => setLast(e.target.value)} /></label>
            <div className="history-presets"><button className="text-button" onClick={() => { const today = localDay(new Date()); setFirst(today); setLast(today); }}>Today</button><button className="text-button" onClick={() => { const date = new Date(); setLast(localDay(date)); date.setDate(date.getDate() - 6); setFirst(localDay(date)); }}>7 days</button></div>
        </div>
        <p className="history-note">Dates and times use your timezone. {configuration ? 'Configuration changes apply to the family.' : 'Only reports returned by COSMO are recorded.'} {collection?.historyStartedAt && `Collection began ${time(collection.historyStartedAt)}.`}</p>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setRetry(v => v + 1)}>Try again</button></div>}
        {loading && !records.length && <p className="history-empty" role="status">Loading saved history…</p>}
        {!loading && !error && !records.length && kind !== 'steps' && <p className="history-empty">No saved reports in this range. History grows as new reports are collected.</p>}
        {kind === 'steps' && <StepsPanel watches={watches} revision={revision} demo={demo} firstDay={first} lastDay={last} embedded />}
        {!!records.length && <>
            {kind === 'locations' && <div className="history-location-grid"><div><WatchMap watches={mapWatch} zones={[]} selected={watchId} onSelect={() => {}} selectedZone={null} onSelectZone={() => {}} fitKey={fitKey} trail={records} activeRecord={active} onSelectRecord={setActive} />{chosen && <p className="history-note">{locationText(chosen)} · Collected {time(chosen.collectedAt)}</p>}</div><div className="history-timeline" aria-label="Location reports">{records.map(r => <button key={r.id} className={`history-row ${active === r.id ? 'is-selected' : ''}`} aria-pressed={active === r.id} onClick={() => setActive(r.id)}><strong>{time(r.recordedAt)}</strong><span>{locationText(r)}</span></button>)}</div></div>}
            {kind === 'watch-readings' && <BatteryHistory records={records} />}
            {kind === 'steps' && <div className="history-timeline">{records.map(r => { const p = r.payload as StepRecord; return <div key={r.id} className="history-row"><strong>{p.count.toLocaleString()} steps</strong><span>{p.day ? `Daily total · ${stepDayLabel(p.day)}` : `${time(p.start)} – ${time(p.end)}`}</span></div>; })}<p className="history-note">Daily totals update as COSMO receives reports. Older interval reports may overlap; counts are not added together.</p></div>}
            {kind === 'notifications' && <div className="history-timeline">{records.map(r => { const n = r.payload as WatchNotification; return <div key={r.id} className="history-row"><strong>{n.body}</strong><span>{time(r.recordedAt)}{!n.createdAt && ' · Collection time; notification time unknown'} · {n.read === null ? 'Read status unknown' : n.read ? 'Read' : 'Unread'}</span></div>; })}</div>}
            {configuration && <div className="history-timeline">{records.map(r => { const p = r.payload as { state: string; items: (Zone | Schedule)[] }; return <div key={r.id} className="history-row"><strong>{time(r.recordedAt)} · {p.items.length} {labels[kind].toLowerCase()}</strong>{p.items.map(item => <span key={item.id}>{item.name} · {item.enabled ? 'Enabled' : 'Disabled'} · {'latitude' in item ? `${item.radius} m radius · ${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}` : `${item.kind} · ${clock(item.time)}${item.endTime !== null ? ` – ${clock(item.endTime)}` : ''}`} · {item.watchIds.map(id => watches.find(w => w.id === id)?.name ?? 'Archived watch').join(', ') || 'No watches assigned'}{'weekDays' in item && item.weekDays ? ` · ${item.weekDays.map((v, i) => v ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i] : '').filter(Boolean).join(', ')}` : ''}</span>)}{!p.items.length && <span>No configured entries.</span>}</div>; })}</div>}
            <div className="history-bottom"><span>{records.length} saved records shown{page.nextCursor ? ' · More available' : ''}</span>{page.nextCursor && <button className="refresh-button" disabled={loading} onClick={() => { const request = new AbortController(); controller.current = request; void load(page.nextCursor, request.signal); }}>{loading ? 'Loading…' : 'Load older records'}</button>}</div>
        </>}
        </div>}
    </section>;
}
function clock(seconds: number | null) { return seconds === null ? 'Time unknown' : `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}`; }
function locationText(record: HistoryRecord) {
    const p = record.payload as Location;
    return `${p.reportedAt ? 'Reported location' : 'Report time unknown; collection time shown'} · ${p.radius === null ? 'Accuracy unknown' : `~${p.radius} m accuracy`}`;
}
function BatteryHistory({ records }: { records: HistoryRecord[] }) {
    const chronological = [...records].reverse(), first = Date.parse(chronological[0].recordedAt), last = Date.parse(chronological[chronological.length - 1].recordedAt);
    const x = (r: HistoryRecord) => 35 + (Date.parse(r.recordedAt) - first) / Math.max(1, last - first) * 730;
    return <div className="battery-history"><svg viewBox="0 0 800 180" role="img" aria-label="Reported battery percentage over the displayed collection times">
        {[0, 50, 100].map(n => <g key={n}><line x1="35" x2="765" y1={150 - n * 1.3} y2={150 - n * 1.3} stroke="#e2e5dc" /><text x="2" y={154 - n * 1.3} fontSize="11" fill="#6c776e">{n}%</text></g>)}
        {chronological.map((r, i) => { const w = r.payload as Watch, old = chronological[i - 1], previous = old?.payload as Watch | undefined; if (w.battery === null) return null; return <g key={r.id}>{old && previous?.battery !== null && previous?.battery !== undefined && Date.parse(r.recordedAt) - Date.parse(old.recordedAt) <= 15 * 60_000 && <line x1={x(old)} y1={150 - previous.battery * 1.3} x2={x(r)} y2={150 - w.battery * 1.3} stroke="#2d7768" strokeWidth="2" />}<circle cx={x(r)} cy={150 - w.battery * 1.3} r="3" fill="#2d7768"><title>{time(r.recordedAt)} · {w.battery}%</title></circle></g>; })}
        <text x="35" y="175" fontSize="11">{time(chronological[0].recordedAt)}</text><text x="765" y="175" textAnchor="end" fontSize="11">{time(chronological[chronological.length - 1].recordedAt)}</text>
    </svg><div className="history-timeline" aria-label="Battery and power readings">{records.map((r, i) => { const w = r.payload as Watch, previous = records[i + 1]?.payload as Watch | undefined; return <div key={r.id} className="history-row"><strong>{w.battery === null ? 'Battery unknown' : `${w.battery}% battery`} · {power(w)}{previous && previous.powerState !== w.powerState && ' · State changed'}</strong><span>{time(r.recordedAt)} · Collection time</span></div>; })}</div></div>;
}
