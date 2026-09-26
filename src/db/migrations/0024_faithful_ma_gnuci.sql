CREATE TABLE `recurring_payment_decisions` (
	`account_id` integer NOT NULL,
	`currency_code` text NOT NULL,
	`merchant_key` text NOT NULL,
	`decision` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recurring_payment_decisions_key` ON `recurring_payment_decisions` (`account_id`,`currency_code`,`merchant_key`);
