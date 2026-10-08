import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarmDays, alarmWatches, splitSchedules } from '../lib/alarms.ts';
import { demoData } from '../lib/demo.ts';
import { normalizeSchedules } from '../lib/filip.server.ts';
import { retainPrevious } from '../lib/types.ts';

test('alarm repeat days use Monday-first ordering and preserve missing data', () => {
    assert.equal(alarmDays([true,false,false,false,false,false,true]), 'Mon, Sun');
    assert.equal(alarmDays([true,true,true,true,true,false,false]), 'Weekdays');
    assert.equal(alarmDays([false,false,false,false,false,true,true]), 'Weekends');
    assert.equal(alarmDays(Array(7).fill(true)), 'Every day');
    assert.equal(alarmDays(Array(7).fill(false)), 'No repeat days selected');
    assert.equal(alarmDays(null), 'Repeat days unavailable');
});

test('alarms exclude school and focus schedules while keeping disabled and midnight alarms', () => {
    const schedules = normalizeSchedules([
        {Id:1,title:'Midnight',enabled:false,time:0,weekDays:[true,false,false,false,false,false,false],devices:[{id:123}]},
        {Id:2,enabled:true,time:28800,schoolMode:true,devices:[]},
        {Id:3,enabled:true,focusMode:true,devices:[]},
    ]);
    const { alarms, modes } = splitSchedules(schedules);
    assert.deepEqual(alarms.map(alarm => [alarm.name,alarm.time,alarm.enabled]), [['Midnight',0,false]]);
    assert.deepEqual(modes.map(mode => mode.kind), ['School mode','Focus mode']);
    assert.deepEqual(splitSchedules([]), {alarms:[],modes:[]});
});

test('alarm assignments name watches without exposing unknown resource IDs', () => {
    assert.equal(alarmWatches(['demo-1','demo-2'],demoData().watches), 'Ellie, Oliver');
    assert.equal(alarmWatches(['private-id'],demoData().watches), 'Unknown watch');
    assert.equal(alarmWatches([],demoData().watches), 'No watches assigned');
});

test('failed alarm refresh retains stale alarms and a confirmed empty response clears them', () => {
    const previous = demoData();
    const stale = retainPrevious({...previous,schedules:[],schedulesState:'unavailable'},previous);
    assert.equal(stale.schedulesState,'stale');
    assert.equal(splitSchedules(stale.schedules).alarms.length,2);
    assert.equal(splitSchedules(retainPrevious({...previous,schedules:[],schedulesState:'empty'},previous).schedules).alarms.length,0);
});
