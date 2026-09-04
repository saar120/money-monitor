ALTER TABLE `categories` ADD `resource_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `categories` ADD `updated_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;
