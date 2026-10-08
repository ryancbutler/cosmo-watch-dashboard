'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Watch, Zone } from '../lib/types';
import { ageLabel } from '../lib/types';
import { selectedMapPosition } from '../lib/map-view';
import type { HistoryRecord } from '../lib/history';

export default function WatchMap({ watches, zones, selected, onSelect, selectedZone, onSelectZone, fitKey, trail, activeRecord, onSelectRecord }: { watches: Watch[]; zones: Zone[]; selected: string | null; onSelect: (id: string) => void; selectedZone: string | null; onSelectZone: (id: string) => void; fitKey: number; trail?: HistoryRecord[]; activeRecord?: string | null; onSelectRecord?: (id: string) => void }) {
    const container = useRef<HTMLDivElement>(null);
    const instance = useRef<Leaflet.Map | null>(null);
    const layer = useRef<Leaflet.LayerGroup | null>(null);
    const library = useRef<typeof Leaflet | null>(null);
    const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
    const onSelectZoneRef = useRef(onSelectZone); onSelectZoneRef.current = onSelectZone;
    const onSelectRecordRef = useRef(onSelectRecord); onSelectRecordRef.current = onSelectRecord;
    const [ready, setReady] = useState(false), [tileError, setTileError] = useState(false);
    const prevFitKey = useRef(fitKey), prevSelected = useRef<string | null>(null), prevSelectedZone = useRef<string | null>(null), hasFit = useRef(false);
    const prevPosition = useRef<string | null>(null);

    useEffect(() => {
        let disposed = false;
        import('leaflet').then(L => {
            if (disposed || !container.current) return;
            library.current = L;
            const map = L.map(container.current, { zoomControl: false, scrollWheelZoom: false }).setView([43.04, -87.91], 12);
            instance.current = map;
            const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
            resize.observe(container.current);
            map.on('unload', () => resize.disconnect());
            L.control.zoom({ position: 'bottomright' }).addTo(map);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).on('tileerror', () => setTileError(true)).addTo(map);
            layer.current = L.layerGroup().addTo(map);
            setReady(true);
        }).catch(() => setTileError(true));
        return () => { disposed = true; instance.current?.remove(); instance.current = null; };
    }, []);
    useEffect(() => {
        const L = library.current, map = instance.current, group = layer.current;
        if (!ready || !L || !map || !group) return;
        group.clearLayers();
        let selectedCircle: Leaflet.Circle | null = null;
        for (const z of zones.filter(z => z.enabled || z.id === selectedZone)) {
            const chosen = z.id === selectedZone;
            const circle = L.circle([z.latitude, z.longitude], { radius: z.radius, color: z.enabled ? chosen ? '#206c58' : '#5f9387' : '#7a766e', weight: chosen ? 3.5 : 1.5, dashArray: chosen && z.enabled ? undefined : '5 6', fillOpacity: chosen ? 0.24 : 0.08, className: chosen ? 'safe-zone-selected' : 'safe-zone-circle' }).addTo(group);
            const label = document.createElement('span'); label.textContent = `${z.name} · ${z.radius} m${z.enabled ? '' : ' · Disabled'}`;
            circle.bindTooltip(label, { permanent: chosen, direction: 'center', className: 'zone-tooltip' });
            circle.on('click', () => onSelectZoneRef.current(z.id));
            if (chosen) selectedCircle = circle;
        }
        const bounds: Leaflet.LatLngExpression[] = [];
        if (trail) {
            let previous: HistoryRecord | null = null;
            for (const record of [...trail].reverse()) {
                const p = record.payload as import('../lib/types').Location;
                const point: Leaflet.LatLngExpression = [p.latitude, p.longitude]; bounds.push(point);
                const label = document.createElement('span'); label.textContent = `${p.reportedAt ? 'Reported' : 'Collected · report time unknown'} ${new Date(record.recordedAt).toLocaleString()}`;
                L.circleMarker(point, { radius: record.id === activeRecord ? 8 : 5, color: '#2d7768', fillOpacity: .8, weight: 2 }).addTo(group).bindTooltip(label).on('click', () => onSelectRecordRef.current?.(record.id));
                if (previous) {
                    const old = previous.payload as import('../lib/types').Location;
                    const gap = Date.parse(record.recordedAt) - Date.parse(previous.recordedAt);
                    if (p.reportedAt && old.reportedAt && gap >= 0 && gap <= 15 * 60_000) L.polyline([[old.latitude, old.longitude], point], { color: '#2d7768', weight: 2, dashArray: '4 6', opacity: .55 }).addTo(group);
                }
                previous = record;
            }
        }
        watches.forEach((w, i) => {
            if (!w.location) return;
            const point: Leaflet.LatLngExpression = [w.location.latitude, w.location.longitude]; bounds.push(point);
            const color = i % 2 === 0 ? '#2d7768' : '#a8783c';
            if (w.location.radius !== null) L.circle(point, { radius: w.location.radius, color, weight: 1, fillOpacity: 0.1 }).addTo(group);
            const initial = w.name.trim().slice(0, 1).toUpperCase() || String(i + 1);
            const html = `<span class="map-pin ${selected === w.id ? 'chosen' : ''}" style="--pin-color:${color}"><b>${initial}</b></span>`;
            const marker = L.marker(point, { icon: L.divIcon({ className: 'watch-marker', html, iconSize: [40, 48], iconAnchor: [20, 48] }), keyboard: true, title: `Select ${w.name}'s watch`, alt: `${w.name}'s last-known location` }).addTo(group);
            const label = document.createElement('div'); label.textContent = `${w.name} · ${ageLabel(w.location.reportedAt)}`;
            marker.bindTooltip(label, { direction: 'top', offset: [0, -44] });
            marker.on('click', () => onSelectRef.current(w.id));
        });
        const initial = !hasFit.current;
        const fit = fitKey !== prevFitKey.current;
        const position = selectedMapPosition(watches, selected);
        if (selectedCircle && (initial || fit || selectedZone !== prevSelectedZone.current)) {
            map.fitBounds(selectedCircle.getBounds(), { padding: [45, 45], maxZoom: 17, animate: !initial && !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
            hasFit.current = true;
        } else if (bounds.length && (initial || fit)) { map.fitBounds(L.latLngBounds(bounds), { padding: [65, 65], maxZoom: 15, animate: !initial }); hasFit.current = true; }
        else if (!selectedZone && (selected !== prevSelected.current || position !== prevPosition.current)) {
            const w = watches.find(w => w.id === selected);
            if (w?.location) map.setView([w.location.latitude, w.location.longitude], Math.max(map.getZoom(), 15), { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, duration: 0.7 });
        }
        prevPosition.current = position;
        prevSelected.current = selected; prevSelectedZone.current = selectedZone; prevFitKey.current = fitKey;
        if (trail && activeRecord) {
            const record = trail.find(r => r.id === activeRecord);
            if (record && !fit) { const p = record.payload as import('../lib/types').Location; map.panTo([p.latitude, p.longitude], { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches }); }
        }
    }, [watches, zones, selected, selectedZone, fitKey, ready, trail, activeRecord]);
    const zone = zones.find(z => z.id === selectedZone);
    const hasLocation = watches.some(w => w.location) || zones.some(z => z.enabled) || !!zone || !!trail?.length;
    return <div className="map-wrap"><div ref={container} className="map-canvas" aria-label="Family watch locations" />
        {!hasLocation && <div className="map-message">No watch locations or safe zones available</div>}
        {tileError && <div className="tile-notice" role="status">Map tiles are unavailable. Location details are still below.</div>}
        <div className="map-caption"><span className="tiny-dot" /><span role="status">{trail ? 'Sampled reports · Dashed lines are not an exact route' : zone ? `${zone.name} \u00b7 ${zone.enabled ? 'Safe zone' : 'Disabled safe zone'}` : 'Last-known locations \u00b7 Approximate accuracy'}</span></div>
    </div>;
}
