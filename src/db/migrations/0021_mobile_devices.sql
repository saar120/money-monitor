CREATE TABLE `mobile_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_digest` text NOT NULL,
	`capabilities` text DEFAULT '["mobile.read"]' NOT NULL,
	`protocol_version` integer DEFAULT 1 NOT NULL,
	`token_version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`rotated_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mobile_devices_token_digest` ON `mobile_devices` (`token_digest`);
--> statement-breakpoint
CREATE INDEX `idx_mobile_devices_revoked_at` ON `mobile_devices` (`revoked_at`);
