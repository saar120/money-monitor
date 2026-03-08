CREATE INDEX IF NOT EXISTS `idx_transactions_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transactions_account_id` ON `transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transactions_date_ignored` ON `transactions` (`date`,`ignored`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transactions_account_date` ON `transactions` (`account_id`,`date`);
