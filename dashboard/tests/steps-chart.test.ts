import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dailyStepValues,stepDays} from '../lib/steps-chart.ts';
import type {HistoryRecord} from '../lib/history.ts';
const record=(day:string,count:number,at='2026-10-07T00:00:00Z'):HistoryRecord=>({id:day,kind:'steps',watchId:'123',recordedAt:`${day}T12:00:00Z`,collectedAt:at,payload:{day,count,start:day,end:day}});
test('daily chart preserves missing gaps and real zero, and uses latest corrections without summing',()=>{
    const values=dailyStepValues([record('2026-10-01',100),record('2026-10-01',150,'2026-10-07T01:00:00Z'),record('2026-10-03',0)]);
    assert.equal(values.get('2026-10-01'),150);assert.equal(values.get('2026-10-02'),undefined);assert.equal(values.get('2026-10-03'),0);
    assert.equal(dailyStepValues([{...record('2026-10-01',100),payload:{count:100,start:'2026-10-01',end:'2026-10-01'}},record('2026-02-30',4),record('2026-10-04',-1)]).size,0);
});
test('chart ranges include historical calendar days across month and DST boundaries',()=>{
    assert.deepEqual(stepDays('2026-10-31','2026-11-02'),['2026-10-31','2026-11-01','2026-11-02']);
    assert.equal(stepDays('2026-09-07','2026-10-06').length,30);
    for(const range of [['2026-02-30','2026-03-01'],['2026-10-06','2026-10-01'],['2026-09-01','2026-10-06']])assert.throws(()=>stepDays(...range as [string,string]));
});
