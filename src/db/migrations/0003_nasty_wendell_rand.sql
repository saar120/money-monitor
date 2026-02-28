ALTER TABLE `accounts` ADD `account_type` text DEFAULT 'bank' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `balance` real;--> statement-breakpoint
ALTER TABLE `transactions` ADD `meta` text;