'use client';
import { useState } from 'react';
import { Bell, ChevronDown, Clock3 } from 'lucide-react';
import type { Availability, Watch, WatchNotification } from '../lib/types';

export default function NotificationFeed({ notifications, watches, state, loading }: { notifications: WatchNotification[]; watches: Watch[]; state: Availability; loading: boolean }) {
    const [filter, setFilter] = useState('all'), [limit, setLimit] = useState(10), [expanded, setExpanded] = useState(false);
    const records = notifications.filter(n => filter === 'all' || n.watchId === filter);
    return <section className="panel notifications-panel" id="notifications" aria-labelledby="notification-heading">
        <div className="panel-heading notification-heading"><div><h2 id="notification-heading">Notifications</h2><p className="notification-subtitle">Recent updates from your watches.</p></div>
            <button className="collapse-button" type="button" aria-label={expanded ? 'Collapse notifications' : 'Expand notifications'} aria-expanded={expanded} aria-controls="notification-content" onClick={() => setExpanded(value => !value)}>{records.length ? `${records.length} updates` : 'Updates'}<ChevronDown size={17} className={expanded ? 'expanded' : ''} /></button></div>
        {expanded && <div id="notification-content"><div className="notification-controls"><label className="notification-filter">Watch<select aria-label="Filter notifications by watch" value={filter} onChange={e => { setFilter(e.target.value); setLimit(10); }}><option value="all">All watches</option>{watches.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label></div>
        {state === 'stale' && <p className="notification-notice" role="status">Older notifications · refresh unavailable</p>}
        {records.length ? <ul className="notification-list">{records.slice(0,limit).map(n => <li className="notification-row" key={n.id}>
            <span className="row-icon"><Bell size={18} /></span><div className="notification-content"><div className="notification-meta"><strong>{watches.find(w => w.id === n.watchId)?.name ?? 'Family notification'}</strong><span className={`read-badge ${n.read === false ? 'unread' : ''}`}>{n.read === false ? 'Unread' : n.read === true ? 'Read' : 'Read status unavailable'}</span></div>
                <p>{n.body}</p><span className="notification-date"><Clock3 size={12} />{n.createdAt ? <time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString([], { month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit' })}</time> : 'Time unavailable'}</span></div>
        </li>)}</ul> : <div className="empty-state" role="status"><span className="empty-icon"><Bell size={25} /></span><h3>{loading ? 'Loading notifications' : state === 'unavailable' ? 'Notifications temporarily unavailable' : filter === 'all' ? 'No notifications reported' : 'No notifications for this watch'}</h3><p>{state === 'unavailable' ? 'Try refreshing to load your notification history.' : 'Watch updates will appear here when they are available.'}</p></div>}
        {records.length > limit && <button className="notification-more" onClick={() => setLimit(n => n + 10)}>Show more notifications ({records.length - limit} remaining)</button>}</div>}
        <div className="panel-footer"><span>{expanded ? 'Latest 100 notifications' : 'Notification history collapsed'}</span><span>View only</span></div>
    </section>;
}
