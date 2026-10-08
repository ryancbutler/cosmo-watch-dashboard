'use client';
import { useEffect, useState } from 'react';
import WatchMap from './watch-map';
import { demoHistory } from '../lib/demo-history';
import type { HistoryKind, HistoryRecord, HistoryPage } from '../lib/history';
import type { Watch } from '../lib/types';
import { timelineEvents } from '../lib/insights';

const kinds = ['locations', 'notifications', 'watch-readings'] as const;
const labelTime = (at: string) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ActivityTimeline({ watch, revision, demo = false }: { watch: Watch | undefined; revision?: string; demo?: boolean }) {
    const [expanded, setExpanded] = useState(false), [records, setRecords] = useState<HistoryRecord[]>([]);
    const [active, setActive] = useState<string | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!expanded || !watch) return;
        const controller = new AbortController();
        const to = new Date(), from = new Date(to.getTime() - 12 * 3600_000);
        const bounds = { from: from.toISOString(), to: to.toISOString() };
        setRecords([]); setActive(null); setLoading(true); setError(null);
        Promise.all(kinds.map(async (kind: HistoryKind) => {
            if (demo) return demoHistory(kind, watch, bounds);
            const params = new URLSearchParams({ kind, watchId: watch.id, ...bounds, limit: '200' });
            const response = await fetch(`/api/history?${params}`, { cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error('Recent activity is unavailable.');
            const page = await response.json() as HistoryPage;
            return page.records;
        })).then(pages => { if (!controller.signal.aborted) setRecords(pages.flat()); })
            .catch(() => { if (!controller.signal.aborted) setError('Recent activity could not be loaded.'); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [expanded, watch?.id, revision, demo, retry]);
    const locations = records.filter(r => r.kind === 'locations');
    const events = timelineEvents(records);
    return <section className="panel recent-panel" aria-labelledby="recent-heading">
        <div className="panel-heading"><div><h2 id="recent-heading">Recent activity</h2><p>Location reports, notifications, and observed watch changes together.</p></div><button className="collapse-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? 'Hide activity' : 'Show activity'}</button></div>
        {expanded && <div className="recent-content">
            <p className="history-note">{watch ? `${watch.name} · Most recent 12 hours` : 'Choose a watch to see recent activity.'} Report times and collection times are labeled separately. Showing up to 200 saved reports per category.</p>
            {loading && <p className="history-empty" role="status">Loading recent activity…</p>}
            {error && <div className="error-banner" role="alert">{error}<button onClick={() => setRetry(v => v + 1)}>Try again</button></div>}
            {!loading && !error && watch && !events.length && <p className="history-empty">No recent saved activity for this watch.</p>}
            {!!events.length && <div className="recent-grid"><div className="history-timeline" aria-label="Recent watch activity">{events.map(event => <button type="button" key={event.id} className={`history-row ${active === event.locationId ? 'is-selected' : ''}`} onClick={() => setActive(event.locationId ?? null)}><strong>{event.title}</strong><span>{labelTime(event.at)} · {event.detail}</span></button>)}</div>{!!locations.length && <WatchMap watches={[]} zones={[]} selected={null} onSelect={() => {}} selectedZone={null} onSelectZone={() => {}} fitKey={0} trail={locations} activeRecord={active} onSelectRecord={setActive} />}</div>}
            <p className="history-note">Map lines join nearby saved reports and are not a verified route. Browse saved history below for older records.</p>
        </div>}
    </section>;
}
