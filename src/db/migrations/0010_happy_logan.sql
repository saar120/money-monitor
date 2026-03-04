ALTER TABLE `categories` ADD `ignored_from_stats` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `confidence` real;