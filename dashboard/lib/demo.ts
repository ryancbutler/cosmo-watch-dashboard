import type { DashboardData } from './types';
export function demoData(): DashboardData {
    const now = Date.now(), iso = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
    return { fetchedAt: iso(0), zonesState: 'ok', schedulesState: 'ok', notificationsState: 'ok',
        notifications: [
            { id: 'demo-notice-1', watchId: 'demo-1', createdAt: iso(12), body: 'Ellie arrived at School.', read: false },
            { id: 'demo-notice-2', watchId: 'demo-2', createdAt: iso(45), body: 'Oliver left Home.', read: true },
            { id: 'demo-notice-3', watchId: 'demo-1', createdAt: iso(120), body: 'A new location was reported for Ellie.', read: true },
        ],
        watches: [
            { id: 'demo-1', name: 'Ellie', model: 'JrTrack 5', hardwareVersion: 'JT5_DEMO', battery: 82, powerState: 'on', location: { latitude: 43.0708, longitude: -89.401, radius: 12, reportedAt: iso(2) }, steps: { count: 4238, start: iso(360), end: iso(12) }, goal: 6000, stepsState: 'ok', goalState: 'ok' },
            { id: 'demo-2', name: 'Oliver', model: 'JrTrack 4', hardwareVersion: 'JT4_DEMO', battery: 46, powerState: 'off', location: { latitude: 43.075, longitude: -89.387, radius: 65, reportedAt: iso(7) }, steps: { count: 3156, start: iso(360), end: iso(20) }, goal: 5000, stepsState: 'ok', goalState: 'ok' },
        ],
        zones: [
            { id: 'demo-home', name: 'Home', latitude: 43.0708, longitude: -89.401, radius: 200, enabled: true, watchIds: ['demo-1', 'demo-2'] },
            { id: 'demo-school', name: 'School', latitude: 43.075, longitude: -89.387, radius: 250, enabled: true, watchIds: ['demo-1', 'demo-2'] },
        ],
        schedules: [
            { id: 'demo-focus', name: 'Time to learn', kind: 'School mode', enabled: true, time: 28800, endTime: 54000, weekDays: [true,true,true,true,true,false,false], watchIds: ['demo-1','demo-2'] },
            { id: 'demo-weekend-alarm', name: 'Slow weekend morning', kind: 'Alarm', enabled: false, time: 32400, endTime: null, weekDays: [false,false,false,false,false,true,true], watchIds: ['demo-2'] },
            { id: 'demo-alarm', name: 'A little fresh air', kind: 'Alarm', enabled: true, time: 59400, endTime: null, weekDays: [true,true,true,true,true,false,false], watchIds: ['demo-1'] },
        ],
    };
}
