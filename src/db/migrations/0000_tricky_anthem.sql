CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` text NOT NULL,
	`display_name` text NOT NULL,
	`account_number` text,
	`credentials_ref` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_scraped_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scrape_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`status` text NOT NULL,
	`error_type` text,
	`error_message` text,
	`transactions_found` integer DEFAULT 0,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`identifier` integer,
	`date` text NOT NULL,
	`processed_date` text NOT NULL,
	`original_amount` real NOT NULL,
	`original_currency` text DEFAULT 'ILS' NOT NULL,
	`charged_amount` real NOT NULL,
	`description` text NOT NULL,
	`memo` text,
	`type` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`installment_number` integer,
	`installment_total` integer,
	`category` text,
	`hash` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_hash_unique` ON `transactions` (`hash`);