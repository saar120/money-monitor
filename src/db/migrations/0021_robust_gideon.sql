ALTER TABLE `transactions` ADD `effective_date` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `reporting_date` text GENERATED ALWAYS AS (coalesce(effective_date, date)) VIRTUAL NOT NULL;
