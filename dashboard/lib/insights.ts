import type { DashboardData, Location, Watch, Zone } from './types.ts';
import { olderLocation } from './types.ts';
import type { HistoryRecord } from './history.ts';

export type AttentionItem = { watchId: string; title: string; detail: string };

export function attentionItems(data: DashboardData, now = Date.now()): AttentionItem[] {
    const items: AttentionItem[] = [];
    for (const watch of data.watches) {
        if (watch.powerState === 'off') items.push({ watchId: watch.id, title: `${watch.name}: reported off`, detail: 'Last available power reading' });
        if (watch.battery !== null && watch.battery <= 20) items.push({ watchId: watch.id, title: `${watch.name}: ${watch.battery}% battery`, detail: 'Last reported battery level' });
        if (olderLocation(watch.location, now)) {
            items.push({ watchId: watch.id, title: `${watch.name}: older location`, detail: watch.location?.reportedAt && Number.isFinite(Date.parse(watch.location.reportedAt)) ? 'No location report in over an hour' : 'Report time unavailable' });
        } else if (!watch.location) items.push({ watchId: watch.id, title: `${watch.name}: location unavailable`, detail: 'No valid location in the last saved reading' });
    }
    return items;
}

function distanceMeters(a: Location, b: Zone): number {
    const radians = Math.PI / 180, lat = (b.latitude - a.latitude) * radians, lon = (b.longitude - a.longitude) * radians;
    const angle = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle));
}

export function placeLabel(watch: Watch, zones: Zone[], zoneState: DashboardData['zonesState']): string | null {
    if (!watch.location || zoneState !== 'ok') return null;
    const candidates = zones.filter(zone => zone.enabled && zone.watchIds.includes(watch.id))
        .map(zone => ({ zone, distance: distanceMeters(watch.location!, zone) }))
        .sort((a, b) => a.distance - b.distance);
    for (const { zone, distance } of candidates) {
        const uncertainty = watch.location.radius;
        if (uncertainty === null) {
            if (distance <= zone.radius) return `Near ${zone.name} · accuracy unknown`;
        } else if (distance + uncertainty <= zone.radius) return `Within ${zone.name} · approximate`;
        else if (distance <= zone.radius + uncertainty) return `Near ${zone.name} boundary · uncertain`;
    }
    return null;
}

export type TimelineEvent = { id: string; at: string; title: string; detail: string; locationId?: string };
export function timelineEvents(records: HistoryRecord[]): TimelineEvent[] {
    const events: TimelineEvent[] = [];
    for (const record of records.filter(r => r.kind === 'locations')) {
        const p = record.payload as Location;
        events.push({ id: record.id, at: record.recordedAt, title: 'Location report', detail: p.reportedAt ? `Approx. accuracy ${p.radius === null ? 'unknown' : `~${p.radius} m`}` : 'Report time unknown; collection time shown', locationId: record.id });
    }
    for (const record of records.filter(r => r.kind === 'notifications')) {
        const p = record.payload as import('./types.ts').WatchNotification;
        events.push({ id: record.id, at: record.recordedAt, title: 'Notification', detail: `${p.body}${p.createdAt ? '' : ' · Collection time; notification time unknown'}` });
    }
    const readings = records.filter(r => r.kind === 'watch-readings').sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    for (let i = 1; i < readings.length; i++) {
        const before = readings[i - 1].payload as Watch, current = readings[i].payload as Watch;
        if (current.powerState !== before.powerState && current.powerState !== 'unknown') events.push({ id: `${readings[i].id}:power`, at: readings[i].recordedAt, title: `Power reported ${current.powerState}`, detail: 'Change between saved readings; collection time' });
        if (current.battery !== null && current.battery <= 20 && (before.battery === null || before.battery > 20)) events.push({ id: `${readings[i].id}:battery`, at: readings[i].recordedAt, title: `Battery reported at ${current.battery}%`, detail: 'Low battery in a saved reading; collection time' });
    }
    return events.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
