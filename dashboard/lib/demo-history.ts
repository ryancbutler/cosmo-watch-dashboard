import { demoData } from './demo';
import type { HistoryKind, HistoryRecord } from './history';
import type { Watch } from './types';
import { localCalendarDay } from './steps-chart';
export function demoHistory(kind: HistoryKind, watch: Watch | undefined, bounds: { from: string; to: string }): HistoryRecord[] {
    const data = demoData(), chosen = watch ?? data.watches[0];
    if (kind === 'steps') {
        const today=localCalendarDay();
        return Array.from({length:31},(_,i)=>{
            const day=new Date(Date.parse(`${today}T00:00:00Z`)-i*86400_000).toISOString().slice(0,10),at=`${day}T12:00:00.000Z`;
            const index=data.watches.findIndex(w=>w.id===chosen.id);
            const count=i===0 ? chosen.steps?.count ?? 0 : Math.max(0,Math.round(3800+Math.sin(i*.7+index*1.9)*2300+index*1400));
            return {id:`demo:steps:${chosen.id}:${day}`,kind,watchId:chosen.id,recordedAt:at,collectedAt:new Date().toISOString(),payload:{count,day,start:at,end:at}} as HistoryRecord;
        }).filter(r=>r.recordedAt>=bounds.from && r.recordedAt<bounds.to);
    }
    return Array.from({ length: kind === 'zones' || kind === 'schedules' ? 2 : 12 }, (_, i) => {
        const at = new Date(Date.now() - i * 10 * 60_000).toISOString();
        let payload: HistoryRecord['payload'];
        if (kind === 'locations') payload = { latitude: 43.0708 + i * .0003, longitude: -89.401 + i * .00025, radius: 12 + i * 2, reportedAt: at };
        else if (kind === 'watch-readings') payload = { ...chosen, battery: Math.min(100, 72 + i), powerState: i < 9 ? 'on' : 'off' };
        else if (kind === 'notifications') payload = { id: `fictional-${i}`, watchId: chosen.id, createdAt: at, body: ['Arrived at School.', 'Left Home.', 'New watch report available.'][i % 3], read: i > 1 };
        else payload = { state: 'ok', items: data[kind] };
        return { id: `demo:${kind}:${i}`, kind, watchId: chosen.id, recordedAt: at, collectedAt: at, payload };
    }).filter(r => r.recordedAt >= bounds.from && r.recordedAt < bounds.to);
}
