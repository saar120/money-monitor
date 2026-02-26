CREATE TABLE `categories` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL UNIQUE,
  `label` text NOT NULL,
  `color` text,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `label`, `color`) VALUES
  ('food', 'Food', '#22c55e'),
  ('transport', 'Transport', '#3b82f6'),
  ('housing', 'Housing', '#f59e0b'),
  ('utilities', 'Utilities', '#6366f1'),
  ('entertainment', 'Entertainment', '#ec4899'),
  ('health', 'Health', '#14b8a6'),
  ('shopping', 'Shopping', '#f97316'),
  ('education', 'Education', '#8b5cf6'),
  ('subscriptions', 'Subscriptions', '#06b6d4'),
  ('income', 'Income', '#84cc16'),
  ('transfer', 'Transfer', '#64748b'),
  ('other', 'Other', '#94a3b8');
