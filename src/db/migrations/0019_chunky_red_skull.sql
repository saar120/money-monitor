ALTER TABLE `accounts` ADD `manual_scrape_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `staleness_days` integer;