CREATE TABLE `account_balance_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`date` text NOT NULL,
	`balance` real NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_account_balance_history_account_date` ON `account_balance_history` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `asset_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`holding_id` integer,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`quantity` real NOT NULL,
	`currency` text NOT NULL,
	`price_per_unit` real,
	`source_amount` real,
	`source_currency` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `asset_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`date` text NOT NULL,
	`holdings_snapshot` text,
	`total_value_ils` real NOT NULL,
	`exchange_rates` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_asset_snapshots_asset_date` ON `asset_snapshots` (`asset_id`,`date`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`institution` text,
	`liquidity` text DEFAULT 'liquid' NOT NULL,
	`linked_account_id` integer,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`linked_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_name_unique` ON `assets` (`name`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`cost_basis` real DEFAULT 0 NOT NULL,
	`last_price` real,
	`last_price_date` text,
	`notes` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_holdings_asset_name` ON `holdings` (`asset_id`,`name`);--> statement-breakpoint
CREATE TABLE `liabilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text DEFAULT 'ILS' NOT NULL,
	`original_amount` real NOT NULL,
	`current_balance` real NOT NULL,
	`interest_rate` real,
	`start_date` text,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `liabilities_name_unique` ON `liabilities` (`name`);