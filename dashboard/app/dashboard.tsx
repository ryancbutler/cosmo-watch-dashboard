'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Battery, Bell, CalendarDays, Check, ChevronDown, Clock3, Footprints, History, Home, Layers3, MapPin, Maximize2, Minimize2, Navigation, Power, RefreshCw, ShieldCheck, Watch as WatchIcon } from 'lucide-react';

import WatchMap from './watch-map';
import NotificationFeed from './notification-feed';
import HistoryView from './history-view';
import ActivityTimeline from './activity-timeline';
import { attentionItems, placeLabel } from '../lib/insights';
import StepsPanel from './steps-panel';
import AlarmsPanel from './alarms-panel';
import { splitSchedules } from '../lib/alarms';
import { demoData } from '../lib/demo';
import { Dialog } from 'radix-ui';

import { ageLabel, olderLocation, retainPrevious } from '../lib/types';

import type { Availability, DashboardData, Watch } from '../lib/types';



function WatchArt({ amber = false }: { amber?: boolean }) {

    return <svg className="watch-art" viewBox="0 0 100 132" aria-hidden="true"><defs><linearGradient id={amber ? 'amber' : 'teal'} x1="0" y1="0" x2="1" y2="1"><stop stopColor={amber ? '#ebcba0' : '#a8c9bd'} /><stop offset="1" stopColor={amber ? '#b99665' : '#638d7f'} /></linearGradient></defs><path d="M31 10Q30 4 38 4H62Q70 4 69 10L74 44H26Z" fill={amber ? '#d4b487' : '#9abbad'} /><path d="M27 86H73L68 123Q68 128 61 128H39Q32 128 32 123Z" fill={amber ? '#d4b487' : '#9abbad'} /><rect x="14" y="37" width="72" height="64" rx="21" fill={`url(#${amber ? 'amber' : 'teal'})`} /><rect x="21" y="43" width="58" height="52" rx="15" fill="#244b43" /><rect x="86" y="55" width="4" height="14" rx="2" fill="#75877a" /><text x="50" y="65" textAnchor="middle" fill="#e5f0e9" fontSize="15" fontFamily="sans-serif" fontWeight="600">10:08</text><path d="M32 76H42L46 70L52 83L57 76H68" fill="none" stroke="#a8d5ac" strokeWidth="2" strokeLinecap="round" /><circle cx="50" cy="116" r="2" fill="#f5f1e9" /></svg>;

}

function powerLabel(state: Watch['powerState'] | undefined) { return state === 'on' ? 'Powered On' : state === 'off' ? 'Powered Off' : 'Power unknown'; }

function stateLabel(state: Availability, empty: string) { return state === 'unavailable' ? 'Temporarily unavailable' : state === 'stale' ? 'Older data · refresh unavailable' : empty; }

function localTime(timestamp: string | number | null) { return timestamp === null ? 'Time unavailable' : new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

function reportDate(timestamp: string) { return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }

function scheduleTime(seconds: number | null) {

    if (seconds === null) return 'Time unavailable';

    const date = new Date(); date.setHours(Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), 0, 0);

    return localTime(date.getTime());

}



export default function Dashboard({ demo = false, mode = 'history', authEnabled = true }: { demo?: boolean; mode?: 'history' | 'realtime'; authEnabled?: boolean }) {

    const historyEnabled = mode === 'history';
    const [live, setLive] = useState<DashboardData | null>(null);

    const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
    const [zonesExpanded, setZonesExpanded] = useState(false);
    const [schedulesExpanded, setSchedulesExpanded] = useState(false);

    const [selected, setSelected] = useState<string | null>(null), [fitKey, setFitKey] = useState(0);

    const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [now, setNow] = useState(Date.now());
    const [activeSection, setActiveSection] = useState('overview'), [showTechnical, setShowTechnical] = useState(false);

    const request = useRef<AbortController | null>(null);

    const refresh = useCallback(async () => {
        if (demo) { setLive(demoData()); return; }

        if (request.current) return;

        const controller = new AbortController(); request.current = controller; setLoading(true);

        try {

            const response = await fetch('/api/dashboard', { cache: 'no-store', signal: controller.signal });

            if (!response.ok) throw new Error(response.status === 401 ? 'Your session has ended. Sign in again to see your watches.' : 'We couldn’t refresh your watches. Please try again.');

            const data: DashboardData = await response.json();

            setLive(previous => retainPrevious(data, previous)); setError(null);

        } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Connection unavailable.'); }

        finally { if (request.current === controller) { request.current = null; setLoading(false); } }

    }, [demo]);

    useEffect(() => {

        refresh();

        const timer = setInterval(() => { if (!document.hidden) refresh(); }, 300_000);

        const visible = () => { if (!document.hidden) refresh(); };

        document.addEventListener('visibilitychange', visible);

        return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); request.current?.abort(); request.current = null; };

    }, [refresh]);

    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);

    useEffect(() => {
        const sections = ['overview', 'family-map', 'activity', 'safe-zones', 'alarms', 'schedules', 'notifications', 'history'];
        const update = () => setActiveSection(location.hash.slice(1) || 'overview');
        update(); window.addEventListener('hashchange', update);
        const observer = new IntersectionObserver(entries => {
            const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
            if (visible?.target.id) setActiveSection(visible.target.id);
        }, { rootMargin: '-20% 0px -60% 0px', threshold: [0.1, 0.5] });
        sections.forEach(id => document.getElementById(id) && observer.observe(document.getElementById(id)!));
        return () => { window.removeEventListener('hashchange', update); observer.disconnect(); };
    }, [live]);

    const data = live;

    const watches = data?.watches ?? [];
    const { alarms, modes } = splitSchedules(data?.schedules ?? []);

    const watch = watches.find(w => w.id === selected) ?? watches[0];

    const selectedZone = data?.zones.find(z => z.id === selectedZoneId) ?? null;

    const selectWatch = (id: string) => { setSelectedZoneId(null); setSelected(id); setShowTechnical(false); };

    const selectZone = (id: string) => { setSelectedZoneId(id); setFitKey(k => k + 1); document.getElementById('family-map')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); };

    const activeIndex = Math.max(0, watches.findIndex(w => w.id === watch?.id));

    const partial = data && (['unavailable','stale'].includes(data.notificationsState) || data.zonesState === 'unavailable' || data.schedulesState === 'unavailable' || watches.some(w => ['unavailable','stale'].includes(w.stepsState) || ['unavailable','stale'].includes(w.goalState)) || data.zonesState === 'stale' || data.schedulesState === 'stale');

    const reportedLocations = watches.filter(w => w.location).length;
    const attention = data ? attentionItems(data, now) : [];
    const place = watch && data ? placeLabel(watch, data.zones, data.zonesState) : null;

    return <div className="app-shell" id="overview">

        <header className="topbar"><a className="brand" href="#overview" aria-label="COSMO family dashboard"><span className="brand-symbol"><span /><span /><span /><span /></span>cosmo<span className="brand-separator" /><span className="brand-subtitle">Family dashboard</span></a>

            <nav className="desktop-nav" aria-label="Dashboard sections"><a href="#overview" className={activeSection === 'overview' ? 'active' : ''}>Overview</a><a href="#family-map" className={activeSection === 'family-map' ? 'active' : ''}>Locations</a><a href="#activity" className={activeSection === 'activity' ? 'active' : ''}>Activity</a><a href="#alarms" className={activeSection === 'alarms' ? 'active' : ''}>Alarms</a><a href="#notifications" className={activeSection === 'notifications' ? 'active' : ''}>Notifications</a>{historyEnabled && <a href="#history" className={activeSection === 'history' ? 'active' : ''}>History</a>}</nav>

            <span className="private-badge"><ShieldCheck size={15} />{demo ? 'Fictional demo' : authEnabled ? 'Private space' : 'Family dashboard'}</span></header>

        <main className="main-content">

            <div className="page-heading"><div><h1>Your family, in view<span>.</span></h1><p>{historyEnabled ? 'Saved watch reports and your family’s history.' : 'Latest watch reports, refreshed directly.'}</p></div>

                <div className="heading-actions"><button className="refresh-button" disabled={loading} onClick={refresh}><RefreshCw size={15} className={loading ? 'spin' : ''} /><span>Refresh</span></button></div></div>

            {error && <div className="error-banner" role="alert"><span>{error} {live && 'Showing older readings from the last successful refresh.'}</span><button onClick={refresh}>Try again</button>{error.includes('session') && <a href="/signin-with-chatgpt?return_to=/" target="_top">Sign in</a>}</div>}

            {partial && <div className="partial-banner" role="status">Some sections couldn’t refresh. Available watch readings are still shown; retained readings are labeled as older data.</div>}

            {!!attention.length && <section className="attention-panel has-attention" aria-labelledby="attention-heading"><div><h2 id="attention-heading">Needs attention</h2><p>Based on the last available watch readings.</p></div><ul>{attention.map(item => <li key={`${item.watchId}:${item.title}`}><button type="button" onClick={() => selectWatch(item.watchId)}><strong>{item.title}</strong><span>{item.detail}</span></button></li>)}</ul></section>}

            <div className="section-heading"><h2>Your watches <span className="count">{watches.length}</span></h2><span className="sync-note"><span className="tiny-dot" />{data?.collection?.status === 'never' ? 'Waiting for collection' : data ? `${historyEnabled ? 'Collected' : 'Refreshed'} at ${localTime(data.fetchedAt)}` : loading ? 'Loading watch reports…' : 'Waiting for connection'}</span></div>

            <section className="watch-grid" aria-label="Choose a watch">

                {!data && <div className="loading-card" role="status"><WatchIcon size={28} /><div><h3>{loading ? 'Getting your family in view' : 'Your watches will appear here'}</h3><p>{loading ? 'Reading the latest available watch reports…' : 'Refresh to connect to your COSMO account.'}</p></div></div>}

                {data && !watches.length && <div className="loading-card"><WatchIcon size={28} /><div><h3>No watches found</h3><p>No paired watches were returned for this account.</p></div></div>}

                {watches.map((w, i) => <button key={w.id} className={`watch-card ${watch?.id === w.id ? 'is-selected' : ''} ${i % 2 ? 'amber-watch' : ''}`} onClick={() => selectWatch(w.id)} aria-pressed={watch?.id === w.id}>

                    <div className="watch-illustration"><WatchArt amber={i % 2 === 1} /></div><div className="watch-card-content"><div className="watch-title"><h3>{w.name}’s watch</h3><span className={`selection-dot ${watch?.id === w.id ? 'checked' : ''}`}>{watch?.id === w.id && <Check size={12} />}</span></div><p className="model-label">{w.model}</p><div className="watch-battery"><Battery size={17} /><strong>{w.battery === null ? 'Battery unavailable' : `${w.battery}%`}</strong>{w.battery !== null && w.battery <= 20 && <span className="low-battery">Low battery</span>}</div><div className={`watch-power power-${w.powerState}`}><Power size={13} />{powerLabel(w.powerState)}</div><div className="watch-location-age"><MapPin size={13} />{w.location ? ageLabel(w.location.reportedAt, now) : 'Location unavailable'}{olderLocation(w.location, now) && <span className="older-dot" />}</div>{data && placeLabel(w, data.zones, data.zonesState) && <div className="watch-place">{placeLabel(w, data.zones, data.zonesState)}</div>}</div>

                </button>)}

            </section>

            <div className="primary-grid">

                <Dialog.Root><section className="panel map-panel" id="family-map"><div className="panel-heading"><div><h2>Family locations</h2></div><div className="map-actions"><button className="text-button" onClick={() => { setSelectedZoneId(null); setFitKey(k => k + 1); }}><Layers3 size={14} />Show all watches</button><Dialog.Trigger asChild><button type="button" className="text-button"><Maximize2 size={14} aria-hidden="true" />Maximize map</button></Dialog.Trigger></div></div>

                    <WatchMap watches={watches} zones={data?.zones ?? []} selected={selectedZone ? null : watch?.id ?? null} onSelect={selectWatch} selectedZone={selectedZone?.id ?? null} onSelectZone={selectZone} fitKey={fitKey} />

                    <div className="map-bottom"><span><Navigation size={14} /> {reportedLocations} of {watches.length} watches with a reported location</span><span>Read-only view</span></div></section>
                    <Dialog.Portal><Dialog.Overlay className="map-dialog-overlay" /><Dialog.Content className="maximized-map">
                        <div className="panel-heading"><Dialog.Title>Family locations</Dialog.Title><div className="map-actions"><button type="button" className="text-button" onClick={() => { setSelectedZoneId(null); setFitKey(k => k + 1); }}><Layers3 size={14} />Show all watches</button><Dialog.Close asChild><button type="button" className="text-button"><Minimize2 size={14} aria-hidden="true" />Restore map</button></Dialog.Close></div></div>
                        <Dialog.Description className="maximized-map-description">Last-known watch locations and safe zones. Press Escape or Restore map to return.</Dialog.Description>
                        <WatchMap watches={watches} zones={data?.zones ?? []} selected={selectedZone ? null : watch?.id ?? null} onSelect={selectWatch} selectedZone={selectedZone?.id ?? null} onSelectZone={id => { setSelectedZoneId(id); setFitKey(k => k + 1); }} fitKey={fitKey} />
                    </Dialog.Content></Dialog.Portal></Dialog.Root>

                <section className="panel detail-panel"><div className="panel-heading"><div><h2>{watch ? `${watch.name}’s last report` : 'Watch details'}</h2></div><span className={`avatar ${activeIndex % 2 ? 'amber' : ''}`}>{watch?.name.slice(0,1) ?? '—'}</span></div>

                    <div className="location-status"><span className="icon-disc"><MapPin size={21} /></span><div><h3>{!watch?.location ? 'Location unavailable' : place ?? (olderLocation(watch.location, now) ? 'Older location' : 'Last-known location')}</h3><p>{watch?.location ? `${ageLabel(watch.location.reportedAt, now)} · Last reported position` : 'Waiting for a valid watch report'}</p></div></div>

                    <div className="detail-rows detail-summary"><div><span>Power</span><strong>{powerLabel(watch?.powerState)}</strong></div><div><span>Battery</span><strong>{watch?.battery === null || watch?.battery === undefined ? 'Not reported' : `${watch.battery}%`}</strong></div><div><span>Location reported</span><strong>{watch?.location?.reportedAt ? reportDate(watch.location.reportedAt) : 'Not reported'}</strong></div></div>
                    <button className="technical-toggle" aria-expanded={showTechnical} onClick={() => setShowTechnical(value => !value)}>{showTechnical ? 'Hide technical details' : 'Show technical details'}</button>
                    {showTechnical && <div className="detail-rows technical-details"><div><span>Model</span><strong>{watch?.model ?? 'Not reported'}</strong></div><div><span>Hardware version</span><strong className="hardware-version">{watch?.hardwareVersion ?? 'Not reported'}</strong></div><div><span>Coordinates</span><strong>{watch?.location ? `${watch.location.latitude.toFixed(5)}, ${watch.location.longitude.toFixed(5)}` : 'Not reported'}</strong></div><div><span>Approx. accuracy</span><strong>{watch?.location?.radius !== null && watch?.location?.radius !== undefined ? `~${watch.location.radius} m` : 'Not reported'}</strong></div></div>}

                    <div className="gentle-note"><Clock3 size={16} /><p>These are the watch’s last available readings. Refreshing this page doesn’t wake the watch or request a new location.</p></div></section>

            </div>

            <div className="secondary-grid">

                <section className="panel activity-panel" id="activity"><div className="panel-heading"><div><h2>Steps</h2></div><Footprints size={22} className="muted-icon" /></div>

                    {historyEnabled ? <StepsPanel watches={watches} revision={data?.fetchedAt} demo={demo} /> : <div className="list-content">{watches.map(w => <div className="list-row" key={w.id}><div><h3>{w.name}</h3><p>{w.steps ? `${w.steps.count.toLocaleString()} steps · ${reportDate(w.steps.end)}` : stateLabel(w.stepsState, 'Steps not reported')}</p></div></div>)}</div>}
                </section>

                <AlarmsPanel alarms={alarms} watches={watches} state={data?.schedulesState ?? (error ? 'unavailable' : 'empty')} pending={!data && !error} />

                <section className="panel" id="safe-zones" aria-labelledby="safe-zones-heading"><div className="panel-heading"><div><h2 id="safe-zones-heading">Safe zones</h2></div><button type="button" className="collapse-button" aria-expanded={zonesExpanded} aria-controls="safe-zones-content" onClick={() => setZonesExpanded(value => !value)}>{zonesExpanded ? 'Hide zones' : 'Show zones'}<ChevronDown size={16} className={zonesExpanded ? 'expanded' : ''} /></button></div>
                    {zonesExpanded && <div id="safe-zones-content">

                    {data?.zones.length ? <div className="list-content">{data.zones.map(z => <button type="button" className={`list-row zone-button ${selectedZone?.id === z.id ? 'is-selected' : ''}`} key={z.id} aria-pressed={selectedZone?.id === z.id} aria-label={`Show ${z.name} safe zone on map${z.enabled ? '' : ' (disabled)'}`} onClick={() => selectZone(z.id)}><span className="row-icon"><Home size={19} /></span><div><h3>{z.name}</h3><p>{z.radius} m radius · {z.watchIds.length} watches</p></div><span className="small-badge">{z.enabled ? 'Enabled' : 'Disabled'}</span><MapPin size={14} className="zone-map-icon" /></button>)}{data.zonesState === 'stale' && <p className="older-reading">Older zones · refresh unavailable</p>}</div> : <Empty icon={<Home size={25} />} title={stateLabel(data?.zonesState ?? 'empty', 'No safe zones yet')} description="Your configured places will appear here when available." />}

                    <div className="panel-footer"><span>Choose a place to view on map</span><span>View only</span></div></div>}</section>

                <section className="panel" id="schedules" aria-labelledby="schedules-heading"><div className="panel-heading"><div><h2 id="schedules-heading">Schedules</h2></div><button type="button" className="collapse-button" aria-expanded={schedulesExpanded} aria-controls="schedules-content" onClick={() => setSchedulesExpanded(value => !value)}>{schedulesExpanded ? 'Hide schedules' : 'Show schedules'}<ChevronDown size={16} className={schedulesExpanded ? 'expanded' : ''} /></button></div>
                    {schedulesExpanded && <div id="schedules-content">

                    {modes.length ? <div className="list-content">{modes.map(s => <div className="list-row" key={s.id}><span className="row-icon"><Clock3 size={19} /></span><div><h3>{s.name}</h3><p>{s.kind} · {scheduleTime(s.time)}{s.endTime !== null ? ` – ${scheduleTime(s.endTime)}` : ''}</p></div><span className="small-badge">{s.enabled ? 'Enabled' : 'Disabled'}</span></div>)}{data?.schedulesState === 'stale' && <p className="older-reading">Older schedules · refresh unavailable</p>}</div> : <Empty icon={<CalendarDays size={25} />} title={stateLabel(data?.schedulesState ?? 'empty', 'A clear schedule')} description="No school or focus schedules were returned." />}

                    <div className="panel-footer"><span>Schedules, not current mode</span><span>View only</span></div></div>}</section>

            </div>

            <NotificationFeed notifications={data?.notifications ?? []} watches={watches} state={data?.notificationsState ?? (error ? 'unavailable' : 'empty')} loading={!data && loading} />
            {historyEnabled && <ActivityTimeline watch={watch} revision={data?.fetchedAt} demo={demo} />}
            {historyEnabled && <HistoryView watches={data?.historyWatches ?? watches} selectedWatch={watch?.id} collection={data?.collection} revision={data?.fetchedAt} demo={demo} />}

            <footer className="page-footer"><span><ShieldCheck size={14} /> Just your family. Just a little clarity.</span><span>COSMO watch dashboard <span>·</span> Read-only</span></footer>

        </main><nav className="mobile-nav" aria-label="Dashboard sections"><a href="#overview" className={activeSection === 'overview' ? 'active' : ''}><Home size={19} />Overview</a><a href="#family-map" className={activeSection === 'family-map' ? 'active' : ''}><MapPin size={19} />Map</a><a href="#activity" className={activeSection === 'activity' ? 'active' : ''}><Footprints size={19} />Activity</a><a href="#schedules" className={activeSection === 'schedules' ? 'active' : ''}><CalendarDays size={19} />Schedules</a><a href="#notifications" className={activeSection === 'notifications' ? 'active' : ''}><Bell size={19} />Notifications</a>{historyEnabled && <a href="#history" className={activeSection === 'history' ? 'active' : ''}><History size={19} />History</a>}</nav>

    </div>;

}

function Empty({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {

    return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{description}</p></div>;

}

