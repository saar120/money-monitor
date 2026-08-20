CREATE TEMP TABLE IF NOT EXISTS `canonical_0024_preexisting_tables` (`name` text PRIMARY KEY);
--> statement-breakpoint
INSERT OR IGNORE INTO `canonical_0024_preexisting_tables` (`name`)
SELECT `name`
FROM `sqlite_master`
WHERE `type` = 'table'
  AND `name` IN ('canonical_reference_resources', 'canonical_mutation_receipts', 'canonical_seed_state');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `canonical_reference_resources` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`amount_value` text NOT NULL,
	`currency_code` text NOT NULL,
	`resource_version` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `canonical_reference_resources_version_check` CHECK (`resource_version` >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `canonical_mutation_receipts` (
	`client_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`outcome_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`client_id`, `idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `canonical_seed_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`seeded_at` text,
	CONSTRAINT `canonical_seed_state_singleton_check` CHECK (`id` = 1)
);
--> statement-breakpoint
INSERT OR IGNORE INTO `canonical_seed_state` (`id`, `seeded_at`) VALUES (1, NULL);
--> statement-breakpoint
UPDATE `canonical_seed_state`
SET `seeded_at` = COALESCE(`seeded_at`, '1970-01-01T00:00:00.000Z')
WHERE `id` = 1
  AND EXISTS (
    SELECT 1 FROM `canonical_0024_preexisting_tables`
    WHERE `name` = 'canonical_reference_resources'
  )
  AND NOT EXISTS (
    SELECT 1 FROM `canonical_0024_preexisting_tables`
    WHERE `name` = 'canonical_seed_state'
  );
--> statement-breakpoint
DROP TABLE `canonical_0024_preexisting_tables`;
