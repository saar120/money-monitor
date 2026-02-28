CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`label` text NOT NULL,
	`color` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `account_type` text DEFAULT 'bank' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `balance` real;--> statement-breakpoint
ALTER TABLE `transactions` ADD `meta` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `ignored` integer DEFAULT false NOT NULL;