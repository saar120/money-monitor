CREATE INDEX IF NOT EXISTS `idx_transactions_date` ON `transactions` (`date`);
CREATE INDEX IF NOT EXISTS `idx_transactions_account_date` ON `transactions` (`account_id`, `date`);
CREATE INDEX IF NOT EXISTS `idx_transactions_needs_review` ON `transactions` (`needs_review`);
