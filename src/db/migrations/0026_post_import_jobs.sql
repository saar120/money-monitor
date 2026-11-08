CREATE TABLE post_import_jobs (
 id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 source text NOT NULL,
 transaction_ids text NOT NULL,
 results text NOT NULL DEFAULT '[]',
 phase text NOT NULL DEFAULT 'committed',
 updated_at text NOT NULL DEFAULT (datetime('now'))
);
