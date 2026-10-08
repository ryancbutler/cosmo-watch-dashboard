import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const collectionLease = sqliteTable('collection_lease', {
    id: integer('id').primaryKey(), holder: text('holder').notNull(), expiresAt: integer('expires_at').notNull(),
});
export const collectionRuns = sqliteTable('collection_runs', {
    id: text('id').primaryKey(), startedAt: text('started_at').notNull(), finishedAt: text('finished_at'),
    status: text('status').notNull(), error: text('error'),
}, table => [index('runs_started').on(table.startedAt)]);
export const dashboardSnapshots = sqliteTable('dashboard_snapshots', {
    id: text('id').primaryKey(), collectedAt: text('collected_at').notNull(), payload: text('payload').notNull(),
}, table => [index('snapshots_collected').on(table.collectedAt)]);
export const historyRecords = sqliteTable('history_records', {
    id: text('id').primaryKey(), kind: text('kind').notNull(), watchId: text('watch_id').notNull(),
    recordedAt: text('recorded_at').notNull(), collectedAt: text('collected_at').notNull(), payload: text('payload').notNull(),
}, table => [index('history_watch_time').on(table.kind, table.watchId, table.recordedAt, table.id),
    index('history_kind_time').on(table.kind, table.recordedAt, table.id)]);
export const watchCatalog = sqliteTable('watch_catalog', {
    id: text('id').primaryKey(), lastSeen: text('last_seen').notNull(), payload: text('payload').notNull(),
});
