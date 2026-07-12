CREATE TABLE `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `members` (`id`, `name`, `is_active`) VALUES (1, 'Member 1', 1);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `member_id` integer REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action;
--> statement-breakpoint
UPDATE `accounts` SET `member_id` = 1 WHERE `member_id` IS NULL;
--> statement-breakpoint
ALTER TABLE `categories` ADD `default_owner_type` text DEFAULT 'unassigned' NOT NULL;
--> statement-breakpoint
ALTER TABLE `categories` ADD `default_owner_member_id` integer REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `expense_owner_type` text DEFAULT 'unassigned' NOT NULL;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `expense_owner_member_id` integer REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `owner_source` text DEFAULT 'unassigned' NOT NULL;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `owner_confidence` real;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `owner_review_reason` text;
--> statement-breakpoint
UPDATE `transactions`
SET
	`expense_owner_type` = 'member',
	`expense_owner_member_id` = (
		SELECT `member_id`
		FROM `accounts`
		WHERE `accounts`.`id` = `transactions`.`account_id`
	),
	`owner_source` = 'account',
	`owner_confidence` = 1,
	`owner_review_reason` = NULL
WHERE `owner_source` = 'unassigned'
	AND EXISTS (
		SELECT 1
		FROM `accounts`
		WHERE `accounts`.`id` = `transactions`.`account_id`
			AND `accounts`.`member_id` IS NOT NULL
	);
--> statement-breakpoint
CREATE TABLE `ownership_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`account_id` integer REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	`account_member_id` integer REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	`category_name` text,
	`description_contains` text,
	`min_amount` real,
	`max_amount` real,
	`target_owner_type` text NOT NULL,
	`target_owner_member_id` integer REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_transactions_owner` ON `transactions` (`expense_owner_type`,`expense_owner_member_id`);
--> statement-breakpoint
CREATE INDEX `idx_transactions_owner_date` ON `transactions` (`expense_owner_type`,`expense_owner_member_id`,`date`);
--> statement-breakpoint
CREATE INDEX `idx_ownership_rules_enabled_priority` ON `ownership_rules` (`enabled`,`priority`);
--> statement-breakpoint
CREATE INDEX `idx_ownership_rules_account` ON `ownership_rules` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_ownership_rules_account_member` ON `ownership_rules` (`account_member_id`);
--> statement-breakpoint
CREATE INDEX `idx_ownership_rules_category` ON `ownership_rules` (`category_name`);
