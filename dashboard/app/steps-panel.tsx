'use client';
import { useEffect, useRef, useState } from 'react';
import type { Watch } from '../lib/types';
import { stepDayLabel } from '../lib/types';
import type { HistoryPage, HistoryRecord } from '../lib/history';
import { dailyStepValues, localCalendarDay, stepDays } from '../lib/steps-chart';

const colors = ['#287969','#a45e22','#6f62ab','#a94561','#3676a1','#5d752c'];
type Series = {watchId:string;values:Map<string,number>;error:boolean};
export default function StepsPanel({ watches, revision, demo=false, firstDay, lastDay, embedded=false }: {watches:Watch[];revision?:string;demo?:boolean;firstDay?:string;lastDay?:string;embedded?:boolean}) {
    const [range,setRange] = useState(30), [today,setToday] = useState('');
    const chartRef=useRef<SVGSVGElement|null>(null), [chartWidth,setChartWidth]=useState(760);
    const [series,setSeries] = useState<Series[]>([]), [loading,setLoading] = useState(false), [error,setError] = useState<string|null>(null), [retry,setRetry] = useState(0), [selectedDay,setSelectedDay] = useState<string|null>(null);
    useEffect(()=>{ const update=()=>setToday(localCalendarDay()); update(); const timer=setInterval(update,60_000); return ()=>clearInterval(timer); },[]);
    const last = lastDay ?? today;
    const first = firstDay ?? (today ? new Date(Date.parse(`${today}T00:00:00Z`)-(range-1)*86400_000).toISOString().slice(0,10) : '');
    const watchKey = watches.map(w=>w.id).join(',');
    let days:string[]=[];
    try { if(first && last) days=stepDays(first,last); } catch { /* Report range validation in the loader. */ }
    useEffect(()=>{
        if (!first || !last || !watches.length) return;
        const controller = new AbortController(); setLoading(true);setError(null);setSeries([]);setSelectedDay(null);
        async function load() {
            try {
                const days=stepDays(first,last), to=new Date(Date.parse(`${days.at(-1)}T00:00:00Z`)+86400_000).toISOString();
                const results=await Promise.all(watches.map(async watch=>{
                    try {
                        const records:HistoryRecord[]=[];
                        if (demo) {
                            const {demoHistory}=await import('../lib/demo-history'); records.push(...demoHistory('steps',watch,{from:`${first}T00:00:00.000Z`,to}));
                        } else {
                            let cursor:string|null=null;
                            do {
                                const params=new URLSearchParams({kind:'steps',watchId:watch.id,from:`${first}T00:00:00.000Z`,to,limit:'200'});
                                if(cursor) params.set('cursor',cursor);
                                const response=await fetch(`/api/history?${params}`,{cache:'no-store',signal:controller.signal});
                                if(!response.ok) throw new Error('History unavailable');
                                const page=await response.json() as HistoryPage;
                                records.push(...page.records);cursor=page.nextCursor;
                            } while(cursor && !controller.signal.aborted);
                        }
                        return {watchId:watch.id,values:dailyStepValues(records.filter(r=>r.watchId===watch.id)),error:false};
                    } catch { return {watchId:watch.id,values:new Map<string,number>(),error:true}; }
                }));
                if(!controller.signal.aborted) {setSeries(results);if(results.some(r=>r.error))setError('Some watch history could not be loaded. Saved totals are still shown below.');}
            } catch(e) { if(!controller.signal.aborted)setError(e instanceof Error?e.message:'History unavailable.'); }
            finally { if(!controller.signal.aborted)setLoading(false); }
        }
        void load();return ()=>controller.abort();
        // IDs identify the series; refreshed snapshots trigger reloads through revision.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    },[first,last,watchKey,revision,demo,retry]);
    const max=Math.max(1,...series.flatMap(s=>Array.from(s.values.values()))), ceiling=Math.max(1000,Math.ceil(max/1000)*1000);
    const x=(i:number)=>60+i/Math.max(1,days.length-1)*(chartWidth-90), y=(value:number)=>220-value/ceiling*185;
    const available=series.some(s=>days.some(day=>s.values.has(day)));
    useEffect(()=>{const chart=chartRef.current;if(!chart)return;const observer=new ResizeObserver(entries=>setChartWidth(Math.max(280,entries[0].contentRect.width)));observer.observe(chart);return ()=>observer.disconnect();},[available]);
    const inspectDay=selectedDay ?? days.at(-1);
    const todayCounts=watches.map(w=>w.steps?.day===today?w.steps.count:series.find(s=>s.watchId===w.id)?.values.get(today)).filter((n):n is number=>n!==undefined);
    return <div className={`steps-panel ${embedded?'steps-embedded':''}`}>
        <div className="steps-today-heading"><div><h3>Today’s steps</h3><p>{today ? stepDayLabel(today) : 'Daily totals'} · All watches</p></div>{!embedded && <div className="steps-range" aria-label="Step chart range">{[7,30].map(n=><button key={n} aria-pressed={range===n} onClick={()=>setRange(n)}>{n} days</button>)}</div>}</div>
        <div className="steps-family-total"><strong>{todayCounts.length?todayCounts.reduce((sum,n)=>sum+n,0).toLocaleString():'—'}</strong><span>total steps today{todayCounts.length!==watches.length?` · ${todayCounts.length} of ${watches.length} watches reported`:''}</span></div>
        <div className="steps-totals">{watches.map((watch,i)=>{
            const saved=series.find(s=>s.watchId===watch.id)?.values.get(today);
            const snapshot=watch.steps?.day===today?watch.steps.count:undefined;
            const count=snapshot ?? saved;
            return <div className="steps-today" key={watch.id} style={{borderTopColor:colors[i%colors.length]}}><span className="steps-watch-name"><i style={{background:colors[i%colors.length]}} />{watch.name}</span><strong>{count===undefined?'—':count.toLocaleString()}</strong><span>{count===undefined?'Today not reported yet':'steps today'}{watch.stepsState==='stale'?' · Older saved data':''}</span>{watch.goal!==null && <small>{watch.goal.toLocaleString()} step goal</small>}</div>;
        })}</div>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={()=>setRetry(v=>v+1)}>Try again</button></div>}
        {loading && <p className="steps-note" role="status">Loading daily step history…</p>}
        {!loading && !available && !error && <p className="steps-note">No daily reports in this range yet. Missing days are left blank.</p>}
        {available && <><div className="steps-chart-heading"><h3>Daily step history</h3><span>{stepDayLabel(first)} – {stepDayLabel(last)}</span></div><svg ref={chartRef} className="steps-chart" viewBox={`0 0 ${chartWidth} 270`} role="group" aria-label="Daily steps line chart for all watches">
            {[0,.5,1].map(f=><g key={f}><line x1="60" x2={chartWidth-30} y1={y(ceiling*f)} y2={y(ceiling*f)} stroke="#e1e7de"/><text x="49" y={y(ceiling*f)+5} textAnchor="end">{(ceiling*f).toLocaleString()}</text></g>)}
            {series.map(s=>{const i=watches.findIndex(w=>w.id===s.watchId),watch=watches[i];return <g key={s.watchId} aria-label={`${watch?.name} daily steps`}>{days.map((day,index)=>{
                const value=s.values.get(day),previous=s.values.get(days[index-1]);if(value===undefined)return null;
                const label=`${watch?.name}, ${stepDayLabel(day)}: ${value.toLocaleString()} steps`;
                return <g key={day}>{previous!==undefined && <line className="step-line" x1={x(index-1)} y1={y(previous)} x2={x(index)} y2={y(value)} stroke={colors[i%colors.length]} strokeDasharray={i%2?'6 3':undefined}/>}<circle className="step-point" cx={x(index)} cy={y(value)} r={selectedDay===day?5:3.5} fill={colors[i%colors.length]} tabIndex={0} role="button" aria-label={label} aria-pressed={selectedDay===day} onClick={()=>setSelectedDay(day)} onFocus={()=>setSelectedDay(day)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelectedDay(day);}}}><title>{label}</title></circle></g>;
            })}</g>;})}
            {days.filter((_,i)=>i===0||i===days.length-1||i===Math.floor((days.length-1)/2)).map(day=><text key={day} x={x(days.indexOf(day))} y="252" textAnchor={day===first?'start':day===last?'end':'middle'}>{new Date(`${day}T12:00:00Z`).toLocaleDateString([],{month:'short',day:'numeric',timeZone:'UTC'})}</text>)}
        </svg><div className="steps-legend">{watches.map((w,i)=><span key={w.id}><i style={{background:colors[i%colors.length]}}/>{w.name}{series.find(s=>s.watchId===w.id)?.error?' · Unavailable':''}</span>)}</div>
        {inspectDay && <div className="steps-day-detail" aria-live="polite"><strong>{stepDayLabel(inspectDay)}</strong>{watches.map(w=><span key={w.id}>{w.name}: {series.find(s=>s.watchId===w.id)?.values.get(inspectDay)?.toLocaleString() ?? 'Not reported'}{series.find(s=>s.watchId===w.id)?.values.has(inspectDay)?' steps':''}</span>)}</div>}
        <details className="steps-table"><summary>View daily totals</summary><div><table><caption>Saved daily steps for all watches</caption><thead><tr><th scope="col">Day</th>{watches.map(w=><th scope="col" key={w.id}>{w.name}</th>)}</tr></thead><tbody>{[...days].reverse().map(day=><tr key={day}><th scope="row">{stepDayLabel(day)}</th>{watches.map(w=><td key={w.id}>{series.find(s=>s.watchId===w.id)?.values.get(day)?.toLocaleString() ?? '—'}</td>)}</tr>)}</tbody></table></div></details></>}
        <p className="steps-note">Daily totals from saved COSMO reports. Missing days are gaps, not zero. Today updates with each collection.</p>
    </div>;
}
