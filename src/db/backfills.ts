import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema.js';
import { ACCOUNT_TYPE_MAP } from '../shared/types.js';
import { MANUAL_LOGIN_COMPANIES } from '../scraper/scraper.service.js';
import { toIsraelDateStr } from '../shared/dates.js';

export function runBackfills(db: BetterSQLite3Database<typeof schema>, sqlite: BetterSqlite3Database) {
  // Backfill accountType for existing accounts (only if any rows need it)
  const needsBackfill = db.select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(sql`${schema.accounts.accountType} = 'bank' AND ${schema.accounts.companyId} IN ('isracard','amex','max','visaCal','beyahadBishvilha','behatsdaa','pagi')`)
    .all();

  if (needsBackfill.length > 0) {
    for (const [companyId, accountType] of Object.entries(ACCOUNT_TYPE_MAP)) {
      db.update(schema.accounts)
        .set({ accountType })
        .where(eq(schema.accounts.companyId, companyId))
        .run();
    }
  }

  // One-time backfill: set manualLogin for Isracard/Amex accounts after migration 0004.
  // Uses a dedicated flag table to track whether this backfill has already run.
  const backfillKey = 'backfill_manual_login_done';
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _backfill_flags (key TEXT PRIMARY KEY, done INTEGER NOT NULL DEFAULT 1)`);
  const flag = db.all(sql`SELECT 1 FROM _backfill_flags WHERE key = ${backfillKey}`);
  if (flag.length === 0) {
    for (const companyId of MANUAL_LOGIN_COMPANIES) {
      db.update(schema.accounts)
        .set({ manualLogin: true, showBrowser: true })
        .where(sql`${schema.accounts.companyId} = ${companyId} AND ${schema.accounts.manualLogin} = 0`)
        .run();
    }
    sqlite.prepare(`INSERT OR IGNORE INTO _backfill_flags (key) VALUES (?)`).run(backfillKey);
  }

  // One-time backfill: populate FTS5 index from existing transactions after migration 0006.
  const ftsBackfillKey = 'backfill_fts5_transactions_done';
  const ftsFlag = db.all(sql`SELECT 1 FROM _backfill_flags WHERE key = ${ftsBackfillKey}`);
  if (ftsFlag.length === 0) {
    sqlite.exec(`
      INSERT OR IGNORE INTO transactions_fts(rowid, description, memo)
      SELECT id, description, COALESCE(memo, '') FROM transactions
    `);
    sqlite.prepare(`INSERT OR IGNORE INTO _backfill_flags (key) VALUES (?)`).run(ftsBackfillKey);
  }

  // One-time backfill: replace old 12 categories with new 25 + migrate transaction category names
  const catBackfillKey = 'backfill_category_rules_v1';
  const catFlag = db.all(sql`SELECT 1 FROM _backfill_flags WHERE key = ${catBackfillKey}`);
  if (catFlag.length === 0) {
    sqlite.transaction(() => {
      const categoryMapping: Record<string, string> = {
        food: 'groceries',
        transport: 'public-transport',
        housing: 'rent',
        utilities: 'utilities',
        entertainment: 'entertainment',
        health: 'health',
        shopping: 'shopping',
        education: 'education',
        subscriptions: 'subscriptions',
        income: 'income',
        transfer: 'transfer',
        other: 'other',
      };

      for (const [oldName, newName] of Object.entries(categoryMapping)) {
        if (oldName !== newName) {
          db.update(schema.transactions)
            .set({ category: newName })
            .where(eq(schema.transactions.category, oldName))
            .run();
        }
      }

      db.update(schema.transactions)
        .set({
          needsReview: true,
          reviewReason: 'Migrated from "food" — may be restaurants, cafes, or grocery. Please verify.',
        })
        .where(sql`${schema.transactions.category} = 'groceries' AND ${schema.transactions.reviewReason} IS NULL`)
        .run();

      sqlite.exec(`DELETE FROM categories`);

      const newCategories = [
        { name: 'groceries', label: 'Groceries', color: '#22c55e', rules: 'Supermarkets and grocery stores for home cooking/supplies. Common merchants: שופרסל, Rami Levy, רמי לוי, יוחננוף, Victory, AM:PM, מגה, טיב טעם, חצי חינם, Osher Ad. Does NOT include restaurants, cafes, or takeout — use "restaurants" or "cafe-bar".' },
        { name: 'restaurants', label: 'Restaurants', color: '#ef4444', rules: 'Restaurants, fast food, and dining out. Includes food delivery apps (Wolt, 10bis, Cibus, תן ביס). Look for restaurant names, food chains (McDonalds, Dominos, Japanika, shipudei hakikar). Does NOT include cafes/coffee shops — use "cafe-bar".' },
        { name: 'cafe-bar', label: 'Cafe & Bar', color: '#f97316', rules: 'Coffee shops, bars, pubs, and casual drinks. Common merchants: Aroma, ארומה, Cofix, קופיקס, דאדו, Landwer, Greg, coffee shops, bars. For meals at sit-down restaurants use "restaurants".' },
        { name: 'fuel', label: 'Fuel', color: '#3b82f6', rules: 'Gas/petrol station charges. Common merchants: דלק, Delek, פז, Paz, סונול, Sonol, Ten, Yellow, דור אלון. Only fuel purchases — car repairs go to "vehicle".' },
        { name: 'public-transport', label: 'Public Transport', color: '#6366f1', rules: 'Buses, trains, light rail, taxis, ride-sharing. Includes: Rav-Kav (רב-קו), Israel Railways, Moovit, Gett, Yango, מוניות. Does NOT include fuel or parking — those have separate categories.' },
        { name: 'parking', label: 'Parking', color: '#8b5cf6', rules: 'Parking lots, street parking, meters. Common merchants: Pango, פנגו, Cellopark, סלופארק, אחוזת החוף. Only parking charges — fuel and transport are separate.' },
        { name: 'vehicle', label: 'Vehicle', color: '#0ea5e9', rules: 'Car/vehicle maintenance, repairs, parts, tires, oil changes, car wash, MOT/טסט. Common merchants: Tire Center, טייר סנטר. Does NOT include fuel (use "fuel") or parking (use "parking").' },
        { name: 'rent', label: 'Rent', color: '#f59e0b', rules: 'Monthly rent payments for housing. Typically a fixed recurring amount to the same payee. Does NOT include utilities or building fees — those go to "utilities".' },
        { name: 'house-expenses', label: 'House Expenses', color: '#d97706', rules: 'Furniture, home appliances, home improvements, garden supplies, home decor, household items. Common merchants: IKEA, AliExpress (home items), עזריאלי. Does NOT include rent, utilities, or recurring building fees.' },
        { name: 'utilities', label: 'Utilities', color: '#14b8a6', rules: 'Recurring household bills: ועד בית (building committee), electricity (חברת החשמל, IEC), water (מקורות, עירייה), gas, municipal taxes (ארנונה). Also internet and phone bills. Does NOT include rent — use "rent".' },
        { name: 'health', label: 'Health', color: '#10b981', rules: 'Medical expenses: doctors, dentist, pharmacy, medical tests, health fund (קופת חולים, מכבי, כללית, מאוחדת, לאומית). Common merchants: Super-Pharm, סופר פארם, Be Pharm, pharmacies. Does NOT include fitness/gym — use "fitness".' },
        { name: 'fitness', label: 'Fitness & Wellness', color: '#06b6d4', rules: 'Gym memberships, sports activities, personal trainers, barbershop, beauty salons, spa. Common merchants: Barber 7, Holmes Place, gym, fitness. Does NOT include medical/pharmacy — use "health".' },
        { name: 'clothing', label: 'Clothing', color: '#ec4899', rules: 'Clothes, shoes, fashion accessories. Common merchants: Fox, Castro, H&M, Zara, SHEIN, 911 Fashion, Kasta, Terminal X. For general shopping/electronics use "shopping".' },
        { name: 'shopping', label: 'Shopping', color: '#f43f5e', rules: 'General shopping, electronics, tools, household items, and anything not covered by more specific categories. Common merchants: AliExpress (non-home), Amazon, KSP, Bug, Kravitz. For clothes use "clothing", for home items use "house-expenses".' },
        { name: 'subscriptions', label: 'Subscriptions', color: '#a855f7', rules: 'Digital subscriptions, streaming services, software, apps, cloud storage. Common: Netflix, Spotify, Apple, Google One, YouTube Premium, ChatGPT, Adobe, iCloud, HBO Max, Disney+. Small recurring charges, typically monthly.' },
        { name: 'entertainment', label: 'Entertainment', color: '#e879f9', rules: 'Events, concerts, movies, parties, leisure activities, amusement parks, museums, theater. Includes event tickets (Eventbrite, פייבוקס). For digital entertainment subscriptions use "subscriptions".' },
        { name: 'education', label: 'Education', color: '#7c3aed', rules: 'Courses, workshops, books, learning materials, conferences, professional development, tuition, online courses (Udemy, Coursera). For digital subscriptions use "subscriptions".' },
        { name: 'gifts', label: 'Gifts & Donations', color: '#fb923c', rules: 'Gifts for others (birthdays, holidays), charity donations, תרומות. Look for: יום הולדת, מתנה, gift shop, charity, donation. For personal leisure/entertainment use "entertainment".' },
        { name: 'insurance', label: 'Insurance', color: '#64748b', rules: 'Insurance premiums: health insurance, car insurance, life insurance, apartment insurance, ביטוח. Typically fixed recurring monthly charges. Does NOT include health fund fees (those go to "health").' },
        { name: 'loans', label: 'Loans', color: '#94a3b8', rules: 'Loan repayments, interest payments, mortgage payments, credit line payments, הלוואה. Fixed recurring amounts to banks or lenders. Does NOT include savings deposits — use "savings".' },
        { name: 'savings', label: 'Savings', color: '#84cc16', rules: 'Transfers to savings accounts, investment deposits, pension contributions, קרן השתלמות, קופת גמל. Internal transfers specifically intended as savings. For general bank transfers use "transfer".' },
        { name: 'services', label: 'Services', color: '#78716c', rules: 'Professional services: legal, accounting, cleaning, moving, handyman, life events (weddings, funerals). One-time or irregular service payments that do not fit other categories.' },
        { name: 'income', label: 'Income', color: '#16a34a', rules: 'Salary, wages, freelance income, refunds, tax returns, sales proceeds. Any money received that is NOT a bank transfer between own accounts. For inter-account transfers use "transfer".' },
        { name: 'transfer', label: 'Transfer', color: '#475569', rules: 'Bank transfers between own accounts, ATM withdrawals, internal moves, currency exchange. NOT income — salary goes to "income". NOT savings — designated savings go to "savings".' },
        { name: 'other', label: 'Other', color: '#9ca3af', rules: 'Anything that does not clearly fit into any other category. Use sparingly — prefer a more specific category when possible. Set needsReview=true if uncertain.' },
      ];

      for (const cat of newCategories) {
        db.insert(schema.categories)
          .values(cat)
          .onConflictDoUpdate({
            target: schema.categories.name,
            set: { label: cat.label, color: cat.color, rules: cat.rules },
          })
          .run();
      }

      sqlite.prepare(`INSERT OR IGNORE INTO _backfill_flags (key) VALUES (?)`).run(catBackfillKey);
    })();
  }

  // One-time backfill: convert ISO datetime strings to date-only YYYY-MM-DD in Israel timezone.
  // Fixes timezone bug where "2026-11-30T22:00:00.000Z" (= Dec 1 Israel) was grouped into November.
  const dateNormKey = 'backfill_date_normalize_israel';
  const dateNormFlag = db.all(sql`SELECT 1 FROM _backfill_flags WHERE key = ${dateNormKey}`);
  if (dateNormFlag.length === 0) {
    const rows = sqlite.prepare(
      `SELECT id, date, processed_date FROM transactions WHERE date LIKE '%T%'`
    ).all() as Array<{ id: number; date: string; processed_date: string }>;

    if (rows.length > 0) {
      const stmt = sqlite.prepare(`UPDATE transactions SET date = ?, processed_date = ? WHERE id = ?`);
      const batchUpdate = sqlite.transaction((batch: typeof rows) => {
        for (const row of batch) {
          stmt.run(toIsraelDateStr(row.date), toIsraelDateStr(row.processed_date), row.id);
        }
      });
      batchUpdate(rows);
    }

    sqlite.prepare(`INSERT OR IGNORE INTO _backfill_flags (key) VALUES (?)`).run(dateNormKey);
  }

}
