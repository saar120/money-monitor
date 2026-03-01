-- FTS5 virtual table for full-text search on transactions
CREATE VIRTUAL TABLE IF NOT EXISTS transactions_fts USING fts5(
  description,
  memo,
  content='transactions',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- Keep FTS index in sync with transactions table
CREATE TRIGGER IF NOT EXISTS transactions_fts_insert AFTER INSERT ON transactions BEGIN
  INSERT INTO transactions_fts(rowid, description, memo)
  VALUES (new.id, new.description, COALESCE(new.memo, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transactions_fts_delete AFTER DELETE ON transactions BEGIN
  INSERT INTO transactions_fts(transactions_fts, rowid, description, memo)
  VALUES ('delete', old.id, old.description, COALESCE(old.memo, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transactions_fts_update AFTER UPDATE OF description, memo ON transactions BEGIN
  INSERT INTO transactions_fts(transactions_fts, rowid, description, memo)
  VALUES ('delete', old.id, old.description, COALESCE(old.memo, ''));
  INSERT INTO transactions_fts(rowid, description, memo)
  VALUES (new.id, new.description, COALESCE(new.memo, ''));
END;
