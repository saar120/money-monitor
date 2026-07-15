ALTER TABLE `transactions` ADD `charged_currency` text DEFAULT 'ILS' NOT NULL;
--> statement-breakpoint
UPDATE `transactions`
SET `charged_currency` = `original_currency`
WHERE ABS(`original_amount` - `charged_amount`) < 0.000001;
