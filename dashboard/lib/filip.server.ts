// Imported only by server routes. Tokens and account data stay in server memory.
import type { DashboardData, Watch, Zone, Schedule, StepRecord, Availability, WatchNotification } from './types.ts';

const BASE = 'https://api.myfilip.com/v2';
const READS = new Set(['/map', '/stepcounter', '/safezones', '/alarms', '/eventlogs']);
type ObjectData = Record<string, unknown>;
const object = (v: unknown): ObjectData => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Unsupported response');
    return v as ObjectData;
};
const list = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error('Unsupported response'); return v; };
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const text = (v: unknown, fallback = ''): string => typeof v === 'string' ? v.slice(0, 100) : fallback;
const date = (v: unknown): string | null => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const id = (v: unknown): string => { const s = String(v); if (!/^\d+$/.test(s)) throw new Error('Unsupported id'); return s; };
const nonnegative = (v: unknown): number | null => { const n = number(v); return n !== null && n >= 0 ? n : null; };
const dailyPath = (path: string) => /^\/stepcounter\/list\/daily\/simple\/\d+$/.test(path);
const calendarDay = (v: unknown): string => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || date(`${v}T00:00:00Z`)?.slice(0, 10) !== v) throw new Error('Unsupported calendar date');
    return v;
};

export class FilipClient {
    private access: string | null = null;
    private refresh: string | null = null;
    private expires = 0;
    private authPending: Promise<void> | null = null;
    private email: string;
    private password: string;
    private transport: typeof fetch;
    private signal?: AbortSignal;
    constructor(email: string, password: string, transport: typeof fetch = (...args) => fetch(...args), signal?: AbortSignal) {
        this.email = email; this.password = password; this.transport = transport;
        this.signal = signal;
    }
    private async send(method: string, path: string, body?: unknown): Promise<unknown> {
        const allowed = method === 'GET' ? READS.has(path) || /^\/device\/goals\/\d+$/.test(path) : method === 'POST' && (['/token', '/token/refresh'].includes(path) || dailyPath(path));
        if (!allowed) throw new Error('Blocked operation');
        const headers: Record<string, string> = { 'x-accept-version': '1.0', 'x-accept-offset': '0', 'Content-Type': 'application/json; charset=UTF-8', 'Accept': 'application/json', 'User-Agent': 'cosmo-family-dashboard/1.0 (private read-only dashboard)' };
        if ((method === 'GET' || dailyPath(path)) && this.access) headers.Authorization = `Bearer ${this.access}`;
        const signal = this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
        const response = await this.transport(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', redirect: 'manual', signal });
        if (response.status === 401) throw new AuthError();
        if (response.status === 403) throw new Error('Access denied');
        if (!response.ok) throw new UpstreamError('HTTP', response.status, path);
        const payload = object(await response.json());
        if (payload.status === 2) throw new AuthError();
        if (payload.status === 403) throw new Error('Access denied');
        if (typeof payload.status === 'number' && ![0, 200].includes(payload.status)) throw new UpstreamError('API', payload.status, path);
        return payload.data ?? payload;
    }
    private async authenticate(forceLogin = false): Promise<void> {
        if (this.authPending) return this.authPending;
        this.authPending = (async () => {
            let raw: unknown;
            if (this.refresh && !forceLogin) {
                try { raw = await this.send('POST', '/token/refresh', { refreshToken: this.refresh }); }
                catch { raw = await this.login(); }
            } else raw = await this.login();
            const tokens = object(raw);
            if (typeof tokens.accessToken !== 'string' || !tokens.accessToken) throw new Error('Sign-in failed');
            this.access = tokens.accessToken;
            this.refresh = typeof tokens.refreshToken === 'string' ? tokens.refreshToken : null;
            this.expires = date(tokens.expDate) ? Date.parse(String(tokens.expDate)) : 0;
        })();
        try { await this.authPending; } finally { this.authPending = null; }
    }
    private login() {
        return this.send('POST', '/token', { email: this.email.trim().toLowerCase(), password: this.password, whiteLabelId: 18, appBuild: '3.4.0.710' });
    }
    async read(path: string): Promise<unknown> {
        if (!READS.has(path) && !/^\/device\/goals\/\d+$/.test(path)) throw new Error('Blocked operation');
        return this.authenticatedRead('GET', path);
    }
    // This POST queries stored history. /stepcounter/report (watch sync) stays blocked.
    async readDailySteps(watchId: string, startDate: string, endDate: string): Promise<unknown> {
        const path = `/stepcounter/list/daily/simple/${id(watchId)}`;
        calendarDay(startDate); calendarDay(endDate);
        const span = Date.parse(endDate) - Date.parse(startDate);
        if (span <= 0 || span > 31 * 86400_000) throw new Error('Unsupported date range');
        return this.authenticatedRead('POST', path, { startDate, endDate });
    }
    private async authenticatedRead(method: string, path: string, body?: unknown): Promise<unknown> {
        if (!this.access || (this.expires && Date.now() >= this.expires - 120_000)) await this.authenticate();
        const rejectedToken = this.access;
        try { return await this.send(method, path, body); }
        catch (e) {
            if (!(e instanceof AuthError)) throw e;
            if (this.access === rejectedToken) await this.authenticate(true);
            return this.send(method, path, body);
        }
    }
}
class AuthError extends Error {
    constructor() { super('Authentication rejected'); this.name = 'AuthError'; }
}
class UpstreamError extends Error {
    constructor(kind: string, status: number, path: string) {
        super('Resource unavailable');
        this.name = `Upstream ${kind} ${status} ${path.replace(/\d+/g, '{id}')}`;
    }
}

export function normalizeWatches(raw: unknown): Watch[] {
    return list(object(raw).Devices).map(value => {
        const d = object(value), battery = number(d.batteryLevel), latitude = number(d.latitude), longitude = number(d.longitude);
        const hardwareVersion = typeof d.hardwareVersion === 'string' ? d.hardwareVersion.trim() || null : null;
        // JT5 is the observed JrTrack 5 hardware family; do not guess other model codes.
        const hardwareName = text(d.hardwareName, 'COSMO watch');
        const model = hardwareVersion && /^JT5(?:_|$)/i.test(hardwareVersion) ? 'JrTrack 5' : /^watch$/i.test(hardwareName) ? 'COSMO watch' : hardwareName;
        const valid = d.isValid === true && latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
        return { id: id(d.id), name: text(d.firstName, 'Watch'), model, hardwareVersion,
            powerState: d.shutdown === true ? 'off' : d.shutdown === false ? 'on' : 'unknown',
            battery: battery !== null && battery >= 0 && battery <= 100 ? battery : null,
            location: valid ? { latitude: latitude!, longitude: longitude!, radius: nonnegative(d.radius), reportedAt: date(d.gpsDate) } : null,
            steps: null, goal: null, stepsState: 'empty', goalState: 'empty' };
    });
}
export function normalizeSteps(raw: unknown): Map<string, StepRecord | null> {
    return new Map(Array.from(normalizeStepReports(raw), ([watchId, records]) => [watchId, records[0] ?? null]));
}
export function normalizeStepReports(raw: unknown): Map<string, StepRecord[]> {
    const result = new Map<string, StepRecord[]>();
    for (const entry of list(object(raw).devices)) {
        const d = object(entry);
        const records = list(d.InfomarkStepcounters).map(value => {
            const r = object(value), count = nonnegative(r.count), start = date(r.startTime), end = date(r.endTime);
            if (count === null || !Number.isInteger(count) || !start || !end || end < start) throw new Error('Unsupported step record');
            return { count, start, end };
        }).sort((a, b) => Date.parse(b.end) - Date.parse(a.end));
        result.set(id(d.id), records);
    }
    return result;
}
export function normalizeDailySteps(raw: unknown): StepRecord[] {
    return list(object(raw).stepcount).map(value => {
        const r = object(value), day = calendarDay(r.day);
        // Prefer the watch total, including zero; only null falls back.
        const count = number(r.totalStepOnWatch ?? r.totalStep);
        if (count === null || !Number.isSafeInteger(count)) throw new Error('Unsupported daily steps');
        // Noon UTC is a stable date index, not a watch report timestamp. Keep day explicit.
        const at = `${day}T12:00:00.000Z`;
        return { count: Math.max(0, count), day, start: at, end: at };
    }).sort((a,b) => b.day.localeCompare(a.day));
}
export function normalizeGoal(raw: unknown): number | null {
    if (Array.isArray(raw) && !raw.length) return null;
    const g = object(raw);
    if (!Object.keys(g).length) return null;
    const n = nonnegative(g.stepGoal);
    if (n === null || !Number.isInteger(n)) throw new Error('Unsupported goal');
    return n;
}
export function normalizeZones(raw: unknown): Zone[] {
    return list(raw).map(value => {
        const z = object(value);
        const lat = typeof z.latitude === 'string' && z.latitude.trim() ? Number(z.latitude) : z.latitude;
        const lon = typeof z.longitude === 'string' && z.longitude.trim() ? Number(z.longitude) : z.longitude;
        const latitude = number(lat), longitude = number(lon), radius = nonnegative(z.radius);
        if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || radius === null || typeof z.enabled !== 'boolean') throw new Error('Unsupported zone');
        return { id: id(z.Id ?? z.id), name: text(z.name, 'Safe zone'), enabled: z.enabled, latitude, longitude, radius,
            watchIds: list(z.devices).filter(value => object(value).enable === true).map(value => id(object(value).deviceId)) };
    });
}
export function normalizeSchedules(raw: unknown): Schedule[] {
    return list(raw).map(value => {
        const s = object(value);
        // GET returns Alarm, not the differently cased EditAlarm write model.
        if (typeof s.enabled !== 'boolean') throw new Error('Unsupported schedule');
        const clock = (v: unknown) => { const n = number(v); return n !== null && Number.isInteger(n) && n >= 0 && n < 86400 ? n : null; };
        return { id: id(s.Id ?? s.id), name: text(s.title, 'Schedule'), kind: s.focusMode === true ? 'Focus mode' : s.schoolMode === true ? 'School mode' : 'Alarm',
            enabled: s.enabled, time: clock(s.time), endTime: clock(s.endTime),
            weekDays: Array.isArray(s.weekDays) && s.weekDays.length === 7 && s.weekDays.every(v => typeof v === 'boolean') ? s.weekDays as boolean[] : null,
            watchIds: list(s.devices).map(value => id(object(value).id)) };
    });
}
export function normalizeNotifications(raw: unknown, watches: Watch[], limit = 100): WatchNotification[] {
    const watchIds = new Set(watches.map(w => w.id));
    const bodyText = (value: unknown): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500) : '';
    const records = list(raw).map(value => {
        const n = object(value);
        if (n.deleted !== undefined && n.deleted !== null && typeof n.deleted !== 'boolean') throw new Error('Unsupported notification');
        if (n.deleted === true) return null;
        const translated = bodyText(n.translated), description = bodyText(n.description);
        const readable = (value: string) => value && !/^(?:SILENT_)?NOTIFICATION_[A-Z0-9_]+$/.test(value);
        const body = readable(translated) ? translated : readable(description) ? description : 'Notification details unavailable';
        const watchId = typeof n.deviceId === 'number' || typeof n.deviceId === 'string' ? String(n.deviceId) : null;
        return { id: id(n.id), watchId: watchId && watchIds.has(watchId) ? watchId : null,
            createdAt: date(n.created), body, read: typeof n.read === 'boolean' ? n.read : null };
    }).filter((n): n is WatchNotification => n !== null).sort((a,b) => (b.createdAt ? Date.parse(b.createdAt) : -Infinity) - (a.createdAt ? Date.parse(a.createdAt) : -Infinity));
    // Bound a snapshot, without persisting personal notification history.
    const unique = new Map<string, WatchNotification>();
    for (const n of records) if (!unique.has(n.id)) unique.set(n.id,n);
    return Array.from(unique.values()).slice(0, limit);
}
export type CollectedData = { dashboard: DashboardData; stepReports: Map<string, StepRecord[]>; notifications: WatchNotification[] };
export async function fetchCollection(client: FilipClient): Promise<CollectedData> {
    const watches = normalizeWatches(await client.read('/map'));
    const now = Date.now(), startDate = new Date(now - 30 * 86400_000).toISOString().slice(0,10), endDate = new Date(now + 86400_000).toISOString().slice(0,10);
    const [zones, schedules, notifications, ...watchResults] = await Promise.allSettled([
        client.read('/safezones').then(normalizeZones), client.read('/alarms').then(normalizeSchedules), client.read('/eventlogs').then(raw => normalizeNotifications(raw, watches, Infinity)),
        ...watches.map(w => client.readDailySteps(w.id, startDate, endDate).then(normalizeDailySteps)),
        ...watches.map(w => client.read(`/device/goals/${w.id}`).then(normalizeGoal)),
    ]);
    const stepReports = new Map<string, StepRecord[]>();
    const state = (result: PromiseSettledResult<unknown>, empty: boolean): Availability => result.status === 'rejected' ? 'unavailable' : empty ? 'empty' : 'ok';
    for (const [i, w] of watches.entries()) {
        const steps = watchResults[i] as PromiseSettledResult<StepRecord[]>;
        if (steps.status === 'fulfilled') stepReports.set(w.id, steps.value);
        w.steps = steps.status === 'fulfilled' ? steps.value[0] ?? null : null;
        w.stepsState = state(steps, !w.steps);
        const g = watchResults[watches.length+i]; w.goal = g.status === 'fulfilled' ? g.value as number | null : null;
        w.goalState = state(g, w.goal === null);
    }
    const zoneData = zones.status === 'fulfilled' ? zones.value : [];
    const notificationData = notifications.status === 'fulfilled' ? notifications.value : [];
    const scheduleData = schedules.status === 'fulfilled' ? schedules.value : [];
    return { dashboard: { fetchedAt: new Date().toISOString(), watches, zones: zoneData, schedules: scheduleData, notifications: notificationData.slice(0, 100), notificationsState: state(notifications, !notificationData.length),
        zonesState: state(zones, !zoneData.length), schedulesState: state(schedules, !scheduleData.length) }, stepReports, notifications: notificationData };
}
export async function fetchDashboard(client: FilipClient): Promise<DashboardData> { return (await fetchCollection(client)).dashboard; }
export function createDashboardLoader(client: FilipClient, ttl = 20_000) {
    let cache: DashboardData | null = null, pending: Promise<DashboardData> | null = null;
    return async () => {
        if (cache && Date.now() - Date.parse(cache.fetchedAt) < ttl) return cache;
        if (pending) return pending;
        pending = fetchDashboard(client).then(data => { cache = data; return data; });
        try { return await pending; } finally { pending = null; }
    };
}

// Realtime mode reads only latest upstream reports; no daily history query or archive.
export async function fetchRealtimeDashboard(client: FilipClient): Promise<DashboardData> {
    const watches = normalizeWatches(await client.read('/map'));
    const [steps, zones, schedules, notifications, ...goals] = await Promise.allSettled([
        client.read('/stepcounter').then(normalizeSteps), client.read('/safezones').then(normalizeZones),
        client.read('/alarms').then(normalizeSchedules), client.read('/eventlogs').then(raw => normalizeNotifications(raw, watches)),
        ...watches.map(w => client.read(`/device/goals/${w.id}`).then(normalizeGoal)),
    ]);
    for (const [i, watch] of watches.entries()) {
        watch.steps = steps.status === 'fulfilled' ? steps.value.get(watch.id) ?? null : null;
        watch.stepsState = steps.status === 'rejected' ? 'unavailable' : watch.steps ? 'ok' : 'empty';
        watch.goal = goals[i].status === 'fulfilled' ? goals[i].value : null;
        watch.goalState = goals[i].status === 'rejected' ? 'unavailable' : watch.goal === null ? 'empty' : 'ok';
    }
    const state = (r: PromiseSettledResult<unknown[]>) => r.status === 'rejected' ? 'unavailable' : r.value.length ? 'ok' : 'empty';
    return { fetchedAt: new Date().toISOString(), watches,
        zones: zones.status === 'fulfilled' ? zones.value : [], zonesState: state(zones),
        schedules: schedules.status === 'fulfilled' ? schedules.value : [], schedulesState: state(schedules),
        notifications: notifications.status === 'fulfilled' ? notifications.value : [], notificationsState: state(notifications) };
}
