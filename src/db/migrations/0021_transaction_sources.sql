CREATE TABLE `transaction_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	`account_id` integer NOT NULL REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transaction_sources_account_source_external` ON `transaction_sources` (`account_id`,`source`,`external_id`);
--> statement-breakpoint
CREATE INDEX `idx_transaction_sources_transaction` ON `transaction_sources` (`transaction_id`);
--> statement-breakpoint
CREATE INDEX `idx_transaction_sources_account` ON `transaction_sources` (`account_id`);
