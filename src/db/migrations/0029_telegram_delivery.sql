CREATE TABLE telegram_deliveries (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, key text NOT NULL UNIQUE, payload text NOT NULL);
--> statement-breakpoint
CREATE TABLE alert_evaluations (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, key text NOT NULL UNIQUE, payload text NOT NULL);
