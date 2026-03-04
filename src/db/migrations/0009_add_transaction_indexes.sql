CREATE INDEX IF NOT EXISTS `idx_transactions_date` ON `transactions` (`date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transactions_account_date` ON `transactions` (`account_id`, `date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transactions_needs_review` ON `transactions` (`needs_review`);
