import type { Schedule, Watch } from './types';

export function alarmDays(days: boolean[] | null): string {
    if (!days || days.length !== 7) return 'Repeat days unavailable';
    const selected = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter((_, index) => days[index]);
    if (selected.length === 7) return 'Every day';
    if (!selected.length) return 'No repeat days selected';
    if (days.slice(0, 5).every(Boolean) && !days[5] && !days[6]) return 'Weekdays';
    if (selected.length === 2 && days[5] && days[6]) return 'Weekends';
    return selected.join(', ');
}

export function alarmWatches(ids: string[], watches: Watch[]): string {
    if (!ids.length) return 'No watches assigned';
    return ids.map(id => watches.find(watch => watch.id === id)?.name ?? 'Unknown watch').join(', ');
}

export function splitSchedules(schedules: Schedule[]) {
    return { alarms: schedules.filter(schedule => schedule.kind === 'Alarm'), modes: schedules.filter(schedule => schedule.kind !== 'Alarm') };
}
