CREATE INDEX IF NOT EXISTS `idx_transactions_date` ON `transactions` (`date`);
CREATE INDEX IF NOT EXISTS `idx_transactions_account_id` ON `transactions` (`account_id`);
CREATE INDEX IF NOT EXISTS `idx_transactions_category` ON `transactions` (`category`);
CREATE INDEX IF NOT EXISTS `idx_transactions_needs_review` ON `transactions` (`needs_review`);
CREATE INDEX IF NOT EXISTS `idx_transactions_ignored` ON `transactions` (`ignored`);
CREATE INDEX IF NOT EXISTS `idx_transactions_account_date` ON `transactions` (`account_id`, `date`);
CREATE INDEX IF NOT EXISTS `idx_accounts_account_type` ON `accounts` (`account_type`);
