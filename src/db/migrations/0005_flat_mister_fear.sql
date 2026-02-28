CREATE TABLE `scrape_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`account_ids` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
ALTER TABLE `scrape_logs` ADD `session_id` integer REFERENCES scrape_sessions(id);--> statement-breakpoint
ALTER TABLE `scrape_logs` ADD `transactions_new` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `scrape_logs` ADD `duration_ms` integer;