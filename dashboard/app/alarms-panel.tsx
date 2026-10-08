'use client';

import { useState } from 'react';
import { AlarmClock, ChevronDown } from 'lucide-react';
import { alarmDays, alarmWatches } from '../lib/alarms';
import type { Availability, Schedule, Watch } from '../lib/types';

function alarmTime(seconds: number | null) {
    if (seconds === null) return 'Time unavailable';
    // Format wall-clock seconds without a timezone conversion or DST adjustment.
    return new Date(Date.UTC(2000, 0, 1, 0, 0, seconds)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

export default function AlarmsPanel({ alarms, watches, state, pending }: { alarms: Schedule[]; watches: Watch[]; state: Availability; pending: boolean }) {
    const [expanded, setExpanded] = useState(false);
    return <section className="panel alarms-panel" id="alarms" aria-labelledby="alarms-heading">
        <div className="panel-heading"><div><h2 id="alarms-heading"><AlarmClock size={20} aria-hidden="true" /> Alarms <span className="count">{alarms.length}</span></h2></div><button type="button" className="collapse-button" aria-expanded={expanded} aria-controls="alarms-content" onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide alarms' : 'Show alarms'}<ChevronDown size={16} className={expanded ? 'expanded' : ''} aria-hidden="true" /></button></div>
        {expanded && <div id="alarms-content">
        {alarms.length ? <ul className="list-content alarm-list">{alarms.map(alarm => <li className="list-row" key={alarm.id}>
            <span className="row-icon"><AlarmClock size={19} aria-hidden="true" /></span>
            <div className="alarm-details"><h3>{alarm.name}</h3><p className="alarm-time">{alarmTime(alarm.time)}</p><p>{alarmDays(alarm.weekDays)}</p><p>{alarmWatches(alarm.watchIds, watches)}</p></div>
            <span className={`small-badge ${alarm.enabled ? '' : 'alarm-disabled'}`}>{alarm.enabled ? 'Enabled' : 'Disabled'}</span>
        </li>)}</ul> : <div className="empty-state" role="status"><span className="empty-icon"><AlarmClock size={25} aria-hidden="true" /></span>
            <h3>{pending ? 'Loading alarms…' : state === 'unavailable' || state === 'stale' ? 'Alarms temporarily unavailable' : 'No alarms yet'}</h3>
            <p>{pending ? 'Reading saved watch alarms.' : state === 'unavailable' || state === 'stale' ? 'Alarm settings couldn’t be refreshed. Try again later.' : 'No alarms were returned for your family’s watches.'}</p>
        </div>}
        {state === 'stale' && !!alarms.length && <p className="alarm-stale" role="status">Older alarms · refresh unavailable</p>}
        <div className="panel-footer"><span>Scheduled watch time</span><span>View only</span></div>
        </div>}
    </section>;
}
