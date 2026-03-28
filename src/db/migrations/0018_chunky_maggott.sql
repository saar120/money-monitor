CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`amount` real NOT NULL,
	`period` text DEFAULT 'monthly' NOT NULL,
	`category_names` text DEFAULT '[]' NOT NULL,
	`alert_threshold` integer DEFAULT 80 NOT NULL,
	`alert_enabled` integer DEFAULT true NOT NULL,
	`color` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
