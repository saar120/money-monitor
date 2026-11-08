ALTER TABLE transactions ADD COLUMN resource_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN inclusion_source text NOT NULL DEFAULT 'category';
--> statement-breakpoint
UPDATE transactions SET inclusion_source = 'legacy';
--> statement-breakpoint
CREATE TABLE mutation_receipts (
  client_id text NOT NULL,
  command_id text NOT NULL,
  payload_digest text NOT NULL,
  outcome text NOT NULL,
  created_at text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_mutation_receipts_command ON mutation_receipts(client_id, command_id);
--> statement-breakpoint
CREATE TRIGGER transactions_resource_version AFTER UPDATE OF
  account_id, date, effective_date, processed_date, original_amount, original_currency,
  charged_amount, charged_currency, description, category, expense_owner_type,
  expense_owner_member_id, owner_source, owner_confidence, owner_review_reason,
  ignored, inclusion_source, needs_review, review_reason, confidence
ON transactions BEGIN
  UPDATE transactions SET resource_version = OLD.resource_version + 1 WHERE id = NEW.id;
END;
