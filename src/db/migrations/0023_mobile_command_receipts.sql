CREATE TABLE `mobile_command_receipts` (
  `idempotency_key` text PRIMARY KEY NOT NULL,
  `device_id` text NOT NULL REFERENCES `mobile_devices`(`id`),
  `command_type` text NOT NULL,
  `target_reference` text NOT NULL,
  `request_fingerprint` text NOT NULL,
  `outcome` text NOT NULL,
  `result_needs_review` integer NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mobile_command_receipts_device` ON `mobile_command_receipts` (`device_id`);
--> statement-breakpoint
CREATE TABLE `mobile_command_audit_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `device_id` text NOT NULL REFERENCES `mobile_devices`(`id`),
  `command_type` text NOT NULL,
  `target_reference` text NOT NULL,
  `request_id` text NOT NULL,
  `outcome` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mobile_command_audit_events_device` ON `mobile_command_audit_events` (`device_id`);
