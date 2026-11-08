ALTER TABLE holdings ADD COLUMN resource_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TRIGGER holdings_resource_version AFTER UPDATE OF name, type, currency, quantity, cost_basis, last_price, last_price_date, notes ON holdings BEGIN
 UPDATE holdings SET resource_version = OLD.resource_version + 1 WHERE id = NEW.id;
END;
