CREATE TABLE `collection_lease` (
	`id` integer PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `runs_started` ON `collection_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `dashboard_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`collected_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshots_collected` ON `dashboard_snapshots` (`collected_at`);--> statement-breakpoint
CREATE TABLE `history_records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`watch_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`collected_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_watch_time` ON `history_records` (`kind`,`watch_id`,`recorded_at`,`id`);--> statement-breakpoint
CREATE INDEX `history_kind_time` ON `history_records` (`kind`,`recorded_at`,`id`);