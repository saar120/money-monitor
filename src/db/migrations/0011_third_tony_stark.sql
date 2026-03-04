CREATE INDEX `idx_transactions_category` ON `transactions` (`category`);--> statement-breakpoint
CREATE INDEX `idx_transactions_ignored` ON `transactions` (`ignored`);--> statement-breakpoint
CREATE INDEX `idx_transactions_status` ON `transactions` (`status`);