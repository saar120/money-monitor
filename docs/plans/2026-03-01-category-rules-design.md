# Category Rules System Design

## Goal

Replace the current 12 generic categories with ~25 granular categories derived from user's manual tracking data, and add per-category LLM ruling prompts stored in the database.

## Database Changes

### 1. Add `rules` column to `categories` table

```sql
ALTER TABLE categories ADD COLUMN rules TEXT;
```

The `rules` column stores a short natural-language hint for the LLM describing what belongs in the category. Bilingual (English + Hebrew merchant names/keywords).

### 2. Replace old categories with new set

Delete the old 12 categories and insert 25 new ones with pre-populated rules.

### 3. Migrate existing transaction categories

Map old category names → new names so existing transactions aren't orphaned:

| Old | New | Notes |
|-----|-----|-------|
| `food` | `groceries` | Mark `needsReview=true` since some may be restaurants |
| `transport` | `public-transport` | |
| `housing` | `rent` | |
| `utilities` | `utilities` | Same |
| `entertainment` | `entertainment` | Same |
| `health` | `health` | Same |
| `shopping` | `shopping` | Same |
| `education` | `education` | Same |
| `subscriptions` | `subscriptions` | Same |
| `income` | `income` | Same |
| `transfer` | `transfer` | Same |
| `other` | `other` | Same |

## New Categories (25 total)

| Name | Label | Color | Rules (summary) |
|------|-------|-------|-----------------|
| `groceries` | Groceries | #22c55e | Supermarkets, grocery stores. שופרסל, Rami Levy, יוחננוף, Victory |
| `restaurants` | Restaurants | #ef4444 | Restaurants, fast food, dining out, delivery (Wolt, 10bis, Cibus) |
| `cafe-bar` | Cafe & Bar | #f97316 | Coffee shops, bars, pubs. Aroma, Cofix, דאדו |
| `fuel` | Fuel | #3b82f6 | Gas stations, fuel. דלק, פז, סונול, Ten |
| `public-transport` | Public Transport | #6366f1 | Buses, trains, Rav-Kav, Moovit, taxis, Gett |
| `parking` | Parking | #8b5cf6 | Parking lots, meters, Pango, Cellopark |
| `vehicle` | Vehicle | #0ea5e9 | Car maintenance, repairs, tires, oil change |
| `rent` | Rent | #f59e0b | Monthly rent payments |
| `house-expenses` | House Expenses | #d97706 | Furniture, home improvements, appliances, AliExpress home items |
| `utilities` | Utilities | #14b8a6 | ועד בית, electricity (חברת החשמל), water, gas, municipal taxes |
| `health` | Health | #10b981 | Doctors, pharmacy, dental, medical tests. Super-Pharm, pharmacy |
| `fitness` | Fitness & Wellness | #06b6d4 | Gym, sports, barbershop, beauty. Barber 7, gym memberships |
| `clothing` | Clothing | #ec4899 | Clothes, shoes, fashion stores. 911 Fashion, Kasta, Fox |
| `shopping` | Shopping | #f43f5e | General shopping, electronics, tools, household items. Kravitz |
| `subscriptions` | Subscriptions | #a855f7 | Digital subscriptions, streaming, apps. Netflix, Spotify, Google One, Apple |
| `entertainment` | Entertainment | #e879f9 | Events, concerts, parties, leisure activities |
| `education` | Education | #7c3aed | Courses, books, learning materials, conferences |
| `gifts` | Gifts & Donations | #fb923c | Gifts, charity, donations. יום הולדת, תרומה |
| `insurance` | Insurance | #64748b | Health/car/life insurance premiums |
| `loans` | Loans | #94a3b8 | Loan repayments, interest payments |
| `savings` | Savings | #84cc16 | Transfers to savings accounts, investments |
| `services` | Services | #78716c | Professional services, legal, accounting, life events |
| `income` | Income | #16a34a | Salary, wages, freelance income, refunds, sales |
| `transfer` | Transfer | #475569 | Bank transfers, withdrawals, ATM, internal moves between accounts |
| `other` | Other | #9ca3af | Anything that doesn't fit other categories |

## LLM Prompt Enhancement

### Current prompt (bare list):
```
Assign each transaction one of these categories: food, transport, ...
```

### New prompt (with rules):
```
Assign each transaction one of these categories:

- groceries: Supermarkets and grocery stores for home cooking. Common merchants: שופרסל, Rami Levy, יוחננוף, Victory, AM:PM, מגה. Does NOT include restaurants, cafes, or takeout — use 'restaurants' or 'cafe-bar'.
- restaurants: Restaurants, fast food, and dining out. Includes food delivery (Wolt, 10bis, Cibus). Does NOT include cafes/bars — use 'cafe-bar'.
...
```

Categories without rules just show the name (backward compatible).

## CategoryManager UI Changes

Add a textarea for editing category rules:
- Below the existing label/color fields
- Placeholder: "Describe what transactions belong in this category. Include Hebrew merchant names if relevant."
- Saved via existing PATCH `/api/categories/:id` endpoint
- `rules` field added to create/update validation schemas

## API Changes

- `POST /api/categories` — accept optional `rules` field
- `PATCH /api/categories/:id` — accept optional `rules` field
- `GET /api/categories` — return `rules` field

## Files to Modify

1. `src/db/schema.ts` — add `rules` column
2. `src/db/migrations/` — new migration for column + seed data
3. `src/ai/agent.ts` — inject rules into categorization prompt
4. `src/ai/prompts.ts` — update prompt builder to format rules
5. `src/api/categories.routes.ts` — accept/return `rules` field
6. `src/api/validation.ts` — add `rules` to schemas
7. `dashboard/src/components/CategoryManager.vue` — add rules textarea
8. `dashboard/src/api/client.ts` — update Category type
