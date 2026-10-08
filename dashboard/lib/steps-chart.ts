import type { HistoryRecord } from './history.ts';
import type { StepRecord } from './types.ts';

export function localCalendarDay(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function stepDays(first: string, last: string): string[] {
    const start = new Date(`${first}T00:00:00Z`), end = new Date(`${last}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(first) || !/^\d{4}-\d{2}-\d{2}$/.test(last) || !Number.isFinite(+start) || !Number.isFinite(+end) || start.toISOString().slice(0,10)!==first || end.toISOString().slice(0,10)!==last || end < start || +end-+start > 30*86400_000) throw new Error('Choose a range of up to 31 days.');
    return Array.from({length:(+end-+start)/86400_000+1},(_,i)=>new Date(+start+i*86400_000).toISOString().slice(0,10));
}
export function dailyStepValues(records: HistoryRecord[]): Map<string, number> {
    const values = new Map<string,{count:number;at:string}>();
    for (const r of records) {
        const p = r.payload as StepRecord;
        if (r.kind !== 'steps' || !p.day || !Number.isSafeInteger(p.count) || p.count < 0) continue;
        try { stepDays(p.day,p.day); } catch { continue; }
        if (!values.has(p.day) || r.collectedAt >= values.get(p.day)!.at) values.set(p.day,{count:p.count,at:r.collectedAt});
    }
    return new Map(Array.from(values,([day,value])=>[day,value.count]));
}
