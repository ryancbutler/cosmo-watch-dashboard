export type Availability = 'ok' | 'empty' | 'unavailable' | 'stale';
export type Location = { latitude: number; longitude: number; radius: number | null; reportedAt: string | null };
export type StepRecord = { count: number; start: string; end: string; day?: string };
export type Watch = { id: string; name: string; model: string; hardwareVersion: string | null; battery: number | null; powerState: 'on' | 'off' | 'unknown'; location: Location | null; steps: StepRecord | null; goal: number | null; stepsState: Availability; goalState: Availability };
export type Zone = { id: string; name: string; enabled: boolean; latitude: number; longitude: number; radius: number; watchIds: string[] };
export type Schedule = { id: string; name: string; kind: 'Alarm' | 'School mode' | 'Focus mode'; enabled: boolean; time: number | null; endTime: number | null; weekDays: boolean[] | null; watchIds: string[] };
export type WatchNotification = { id: string; watchId: string | null; createdAt: string | null; body: string; read: boolean | null };
export type CollectionStatus = { lastAttempt: string | null; lastSuccess: string | null; status: 'never' | 'running' | 'ok' | 'partial' | 'failed'; historyStartedAt: string | null };
export type DashboardData = { dataMode?: 'history' | 'realtime'; fetchedAt: string; watches: Watch[]; zones: Zone[]; schedules: Schedule[]; notifications: WatchNotification[]; notificationsState: Availability; zonesState: Availability; schedulesState: Availability; collection?: CollectionStatus; historyWatches?: Watch[] };
export function stepDayLabel(day: string): string {
    return new Date(`${day}T12:00:00Z`).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function ageLabel(timestamp: string | null, now = Date.now()): string {
    if (!timestamp) return 'Report time unavailable';
    const elapsed = now - Date.parse(timestamp);
    if (!Number.isFinite(elapsed)) return 'Report time unavailable';
    if (elapsed < -60_000) return 'Report time is in the future';
    const minutes = Math.max(0, Math.floor(elapsed / 60_000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
    return `${Math.floor(minutes / 1440)} days ago`;
}
export function olderLocation(location: Location | null, now = Date.now()): boolean {
    return !!location && (!location.reportedAt || !Number.isFinite(Date.parse(location.reportedAt)) || now - Date.parse(location.reportedAt) > 60 * 60_000);
}
export function retainPrevious(next: DashboardData, previous: DashboardData | null): DashboardData {
    if (!previous) return next;
    return { ...next,
        notifications: next.notificationsState === 'unavailable' ? previous.notifications : next.notifications,
        notificationsState: next.notificationsState === 'unavailable' && previous.notifications.length ? 'stale' : next.notificationsState,
        zones: next.zonesState === 'unavailable' ? previous.zones : next.zones,
        zonesState: next.zonesState === 'unavailable' && previous.zones.length ? 'stale' : next.zonesState,
        schedules: next.schedulesState === 'unavailable' ? previous.schedules : next.schedules,
        schedulesState: next.schedulesState === 'unavailable' && previous.schedules.length ? 'stale' : next.schedulesState,
        watches: next.watches.map(w => {
            const old = previous.watches.find(p => p.id === w.id);
            return { ...w,
                steps: w.stepsState === 'unavailable' ? old?.steps ?? null : w.steps,
                stepsState: w.stepsState === 'unavailable' && old?.steps ? 'stale' : w.stepsState,
                goal: w.goalState === 'unavailable' ? old?.goal ?? null : w.goal,
                goalState: w.goalState === 'unavailable' && old?.goal !== null && old?.goal !== undefined ? 'stale' : w.goalState,
            };
        }),
    };
}
