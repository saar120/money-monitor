# Category Rules System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand from 12 to 25 categories with per-category LLM ruling prompts, migrate existing data, and update the UI.

**Architecture:** Add a `rules` text column to the `categories` table. The LLM categorization prompt injects each category's rules inline. New categories and data migration run as a one-time backfill. The CategoryManager UI gets a rules textarea.

**Tech Stack:** Drizzle ORM (SQLite), Claude Agent SDK, Vue 3 + shadcn-vue, Zod validation

**Design doc:** `docs/plans/2026-03-01-category-rules-design.md`

---

### Task 1: Add `rules` column to schema and generate migration

**Files:**
- Modify: `src/db/schema.ts:66-72`

**Step 1: Add the `rules` column to the categories table definition**

In `src/db/schema.ts`, add `rules` after the `color` column:

```typescript
export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  label: text('label').notNull(),
  color: text('color'),
  rules: text('rules'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

**Step 2: Generate the Drizzle migration**

Run: `npm run db:generate`

Expected: New migration file created in `src/db/migrations/` with `ALTER TABLE categories ADD COLUMN rules text;`

**Step 3: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat: add rules column to categories schema"
```

---

### Task 2: Add category seed + transaction migration backfill

**Files:**
- Modify: `src/db/backfills.ts`

**Step 1: Add the backfill function**

Add a new backfill at the end of `runBackfills()` in `src/db/backfills.ts`. Use the `_backfill_flags` table pattern (same as existing backfills).

```typescript
// One-time backfill: replace old 12 categories with new 25 + migrate transaction category names
const catBackfillKey = 'backfill_category_rules_v1';
const catFlag = db.all(sql`SELECT 1 FROM _backfill_flags WHERE key = ${catBackfillKey}`);
if (catFlag.length === 0) {
  // Map old category names → new names
  const categoryMapping: Record<string, string> = {
    food: 'groceries',
    transport: 'public-transport',
    housing: 'rent',
    // These stay the same but listed for clarity:
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

  // Rename transaction categories that changed
  for (const [oldName, newName] of Object.entries(categoryMapping)) {
    if (oldName !== newName) {
      db.update(schema.transactions)
        .set({ category: newName })
        .where(eq(schema.transactions.category, oldName))
        .run();
    }
  }

  // Mark 'food' → 'groceries' transactions for review (some may be restaurants)
  db.update(schema.transactions)
    .set({
      needsReview: true,
      reviewReason: 'Migrated from "food" — may be restaurants, cafes, or grocery. Please verify.',
    })
    .where(sql`${schema.transactions.category} = 'groceries' AND ${schema.transactions.reviewReason} IS NULL`)
    .run();

  // Delete old categories
  sqlite.exec(`DELETE FROM categories`);

  // Insert new 25 categories with rules
  const newCategories = [
    {
      name: 'groceries',
      label: 'Groceries',
      color: '#22c55e',
      rules: 'Supermarkets and grocery stores for home cooking/supplies. Common merchants: שופרסל, Rami Levy, רמי לוי, יוחננוף, Victory, AM:PM, מגה, טיב טעם, חצי חינם, Osher Ad. Does NOT include restaurants, cafes, or takeout — use "restaurants" or "cafe-bar".',
    },
    {
      name: 'restaurants',
      label: 'Restaurants',
      color: '#ef4444',
      rules: 'Restaurants, fast food, and dining out. Includes food delivery apps (Wolt, 10bis, Cibus, תן ביס). Look for restaurant names, food chains (McDonalds, Dominos, Japanika, shipudei hakikar). Does NOT include cafes/coffee shops — use "cafe-bar".',
    },
    {
      name: 'cafe-bar',
      label: 'Cafe & Bar',
      color: '#f97316',
      rules: 'Coffee shops, bars, pubs, and casual drinks. Common merchants: Aroma, ארומה, Cofix, קופיקס, דאדו, Landwer, Greg, coffee shops, bars. For meals at sit-down restaurants use "restaurants".',
    },
    {
      name: 'fuel',
      label: 'Fuel',
      color: '#3b82f6',
      rules: 'Gas/petrol station charges. Common merchants: דלק, Delek, פז, Paz, סונול, Sonol, Ten, Yellow, דור אלון. Only fuel purchases — car repairs go to "vehicle".',
    },
    {
      name: 'public-transport',
      label: 'Public Transport',
      color: '#6366f1',
      rules: 'Buses, trains, light rail, taxis, ride-sharing. Includes: Rav-Kav (רב-קו), Israel Railways, Moovit, Gett, Yango, מוניות. Does NOT include fuel or parking — those have separate categories.',
    },
    {
      name: 'parking',
      label: 'Parking',
      color: '#8b5cf6',
      rules: 'Parking lots, street parking, meters. Common merchants: Pango, פנגו, Cellopark, סלופארק, אחוזת החוף. Only parking charges — fuel and transport are separate.',
    },
    {
      name: 'vehicle',
      label: 'Vehicle',
      color: '#0ea5e9',
      rules: 'Car/vehicle maintenance, repairs, parts, tires, oil changes, car wash, MOT/טסט. Common merchants: Tire Center, טייר סנטר. Does NOT include fuel (use "fuel") or parking (use "parking").',
    },
    {
      name: 'rent',
      label: 'Rent',
      color: '#f59e0b',
      rules: 'Monthly rent payments for housing. Typically a fixed recurring amount to the same payee. Does NOT include utilities or building fees — those go to "utilities".',
    },
    {
      name: 'house-expenses',
      label: 'House Expenses',
      color: '#d97706',
      rules: 'Furniture, home appliances, home improvements, garden supplies, home decor, household items. Common merchants: IKEA, AliExpress (home items), עזריאלי. Does NOT include rent, utilities, or recurring building fees.',
    },
    {
      name: 'utilities',
      label: 'Utilities',
      color: '#14b8a6',
      rules: 'Recurring household bills: ועד בית (building committee), electricity (חברת החשמל, IEC), water (מקורות, עירייה), gas, municipal taxes (ארנונה). Also internet and phone bills. Does NOT include rent — use "rent".',
    },
    {
      name: 'health',
      label: 'Health',
      color: '#10b981',
      rules: 'Medical expenses: doctors, dentist, pharmacy, medical tests, health fund (קופת חולים, מכבי, כללית, מאוחדת, לאומית). Common merchants: Super-Pharm, סופר פארם, Be Pharm, pharmacies. Does NOT include fitness/gym — use "fitness".',
    },
    {
      name: 'fitness',
      label: 'Fitness & Wellness',
      color: '#06b6d4',
      rules: 'Gym memberships, sports activities, personal trainers, barbershop, beauty salons, spa. Common merchants: Barber 7, Holmes Place, gym, fitness. Does NOT include medical/pharmacy — use "health".',
    },
    {
      name: 'clothing',
      label: 'Clothing',
      color: '#ec4899',
      rules: 'Clothes, shoes, fashion accessories. Common merchants: Fox, Castro, H&M, Zara, SHEIN, 911 Fashion, Kasta, Terminal X. For general shopping/electronics use "shopping".',
    },
    {
      name: 'shopping',
      label: 'Shopping',
      color: '#f43f5e',
      rules: 'General shopping, electronics, tools, household items, and anything not covered by more specific categories. Common merchants: AliExpress (non-home), Amazon, KSP, Bug, Kravitz. For clothes use "clothing", for home items use "house-expenses".',
    },
    {
      name: 'subscriptions',
      label: 'Subscriptions',
      color: '#a855f7',
      rules: 'Digital subscriptions, streaming services, software, apps, cloud storage. Common: Netflix, Spotify, Apple, Google One, YouTube Premium, ChatGPT, Adobe, iCloud, HBO Max, Disney+. Small recurring charges, typically monthly.',
    },
    {
      name: 'entertainment',
      label: 'Entertainment',
      color: '#e879f9',
      rules: 'Events, concerts, movies, parties, leisure activities, amusement parks, museums, theater. Includes event tickets (Eventbrite, פייבוקס). For digital entertainment subscriptions use "subscriptions".',
    },
    {
      name: 'education',
      label: 'Education',
      color: '#7c3aed',
      rules: 'Courses, workshops, books, learning materials, conferences, professional development, tuition, online courses (Udemy, Coursera). For digital subscriptions use "subscriptions".',
    },
    {
      name: 'gifts',
      label: 'Gifts & Donations',
      color: '#fb923c',
      rules: 'Gifts for others (birthdays, holidays), charity donations, תרומות. Look for: יום הולדת, מתנה, gift shop, charity, donation. For personal leisure/entertainment use "entertainment".',
    },
    {
      name: 'insurance',
      label: 'Insurance',
      color: '#64748b',
      rules: 'Insurance premiums: health insurance, car insurance, life insurance, apartment insurance, ביטוח. Typically fixed recurring monthly charges. Does NOT include health fund fees (those go to "health").',
    },
    {
      name: 'loans',
      label: 'Loans',
      color: '#94a3b8',
      rules: 'Loan repayments, interest payments, mortgage payments, credit line payments, הלוואה. Fixed recurring amounts to banks or lenders. Does NOT include savings deposits — use "savings".',
    },
    {
      name: 'savings',
      label: 'Savings',
      color: '#84cc16',
      rules: 'Transfers to savings accounts, investment deposits, pension contributions, קרן השתלמות, קופת גמל. Internal transfers specifically intended as savings. For general bank transfers use "transfer".',
    },
    {
      name: 'services',
      label: 'Services',
      color: '#78716c',
      rules: 'Professional services: legal, accounting, cleaning, moving, handyman, life events (weddings, funerals). One-time or irregular service payments that do not fit other categories.',
    },
    {
      name: 'income',
      label: 'Income',
      color: '#16a34a',
      rules: 'Salary, wages, freelance income, refunds, tax returns, sales proceeds. Any money received that is NOT a bank transfer between own accounts. For inter-account transfers use "transfer".',
    },
    {
      name: 'transfer',
      label: 'Transfer',
      color: '#475569',
      rules: 'Bank transfers between own accounts, ATM withdrawals, internal moves, currency exchange. NOT income — salary goes to "income". NOT savings — designated savings go to "savings".',
    },
    {
      name: 'other',
      label: 'Other',
      color: '#9ca3af',
      rules: 'Anything that does not clearly fit into any other category. Use sparingly — prefer a more specific category when possible. Set needsReview=true if uncertain.',
    },
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
}
```

**Step 2: Verify the backfill compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/db/backfills.ts
git commit -m "feat: add category migration backfill with 25 categories and rules"
```

---

### Task 3: Add `rules` to validation schemas

**Files:**
- Modify: `src/api/validation.ts:116-125`

**Step 1: Add `rules` to both create and update schemas**

In `src/api/validation.ts`, update the category schemas:

```typescript
export const createCategorySchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, 'Name must be lowercase alphanumeric, dashes, or underscores'),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  rules: z.string().max(500).optional(),
});

export const updateCategorySchema = z.object({
  label: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  rules: z.string().max(500).nullable().optional(),
});
```

**Step 2: Commit**

```bash
git add src/api/validation.ts
git commit -m "feat: add rules field to category validation schemas"
```

---

### Task 4: Remove stale `CATEGORIES` const from prompts.ts

**Files:**
- Modify: `src/ai/prompts.ts`

**Step 1: Update prompts.ts**

The `CATEGORIES` const and `Category` type at the top are stale — categories come from the DB at runtime. Remove them, and update `buildFinancialAdvisorPrompt` to accept category objects with rules.

Replace the entire file:

```typescript
export interface CategoryWithRules {
  name: string;
  rules: string | null;
}

/** Format category list for LLM prompt, including per-category rules when available. */
export function formatCategoryList(cats: CategoryWithRules[]): string {
  return cats
    .map(c => c.rules ? `- ${c.name}: ${c.rules}` : `- ${c.name}`)
    .join('\n');
}

export function buildFinancialAdvisorPrompt(cats: CategoryWithRules[]): string {
  const list = cats.map(c => c.name).join(', ');
  return `You are a personal financial advisor with direct access to the user's bank and credit card transaction data from Israeli financial institutions.

Your role:
- Answer questions about spending, income, and financial trends
- Categorize transactions into meaningful categories
- Identify patterns, anomalies, and unusual charges
- Provide actionable savings insights and recommendations
- Compare spending between any two time periods (e.g. this month vs last month)
- Detect recurring subscriptions, memberships, and regular bills
- Identify top merchants by spending, frequency, or average amount
- Analyze spending trends over multiple months to spot increases or decreases

Important rules:
- ALWAYS use your tools to query real data before making claims. Never guess amounts or dates.
- All monetary amounts are in ILS (Israeli New Shekel) unless otherwise stated.
- When showing amounts, format as ₪X,XXX.XX
- When the user asks about "this month", use the current calendar month.
- When the user asks about "last month", use the previous calendar month.
- Be concise but thorough. Use tables for comparative data when helpful.
- If asked to categorize, use these standard categories: ${list}.
- Dates in the database are ISO strings (e.g. "2026-02-24T00:00:00.000Z").

You have access to the following tools to query the user's financial data. Use them as needed.`;
}
```

**Step 2: Update agent.ts to use new prompt signatures**

In `src/ai/agent.ts`, update the helper that fetches categories and all callers:

Replace the `getCategoryNames` function (lines 35-40):

```typescript
async function getCategoriesWithRules(): Promise<{ name: string; rules: string | null }[]> {
  const { db } = await import('../db/connection.js');
  const { categories } = await import('../db/schema.js');
  return db.select({ name: categories.name, rules: categories.rules }).from(categories).all();
}
```

Update the `chat` function (lines 42-76) — change lines 43-45:

```typescript
  const cats = await getCategoriesWithRules();
  const categoryNames = cats.map(c => c.name);
  const systemPrompt = buildFinancialAdvisorPrompt(cats);
```

Update `batchCategorize` (lines 78-147) — replace lines 86-87 and 107-108 and the system prompt (lines 113-119):

```typescript
  // Replace lines 86-87:
  const catRows = db.select({ name: categories.name, rules: categories.rules }).from(categories).all();
  const categoryNames = catRows.map(r => r.name);

  // Replace the system prompt (the one at line 114):
  systemPrompt: `You are a transaction categorizer for an Israeli user's bank transactions. Assign each transaction one of these categories:

${formatCategoryList(catRows)}

If you are confident in the category, set "needsReview" to false.
If the transaction is ambiguous — the description is vague, multiple categories could apply, the amount seems unusual for the category, or the description contradicts the bank-category — set "needsReview" to true and provide a short "reviewReason" explaining why.

Respond with ONLY a JSON array. Each object must have: "id" (number), "category" (string), "needsReview" (boolean). Include "reviewReason" (string) only when needsReview is true. No markdown, no explanation.`,
```

Do the same for the `recategorize` function (lines 149-216) — same pattern: fetch `{ name, rules }`, use `formatCategoryList` in the prompt.

Also add the import at the top of agent.ts:

```typescript
import { buildFinancialAdvisorPrompt, formatCategoryList } from './prompts.js';
```

(Remove the old `import { buildFinancialAdvisorPrompt } from './prompts.js';` if it exists separately — just update it.)

**Step 3: Check for any other imports of the deleted CATEGORIES const**

Run: `grep -r "CATEGORIES\|Category.*prompts" src/` — if anything imports `CATEGORIES` or `Category` from prompts.ts, update or remove those imports.

**Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/ai/prompts.ts src/ai/agent.ts
git commit -m "feat: inject per-category rules into LLM categorization prompt"
```

---

### Task 5: Update frontend — client type and API functions

**Files:**
- Modify: `dashboard/src/api/client.ts:244-268`

**Step 1: Add `rules` to the Category interface**

```typescript
export interface Category {
  id: number;
  name: string;
  label: string;
  color: string | null;
  rules: string | null;
  createdAt: string;
}
```

**Step 2: Update `createCategory` to accept `rules`**

```typescript
export function createCategory(data: { name: string; label: string; color?: string; rules?: string }) {
  return request<{ category: Category }>('/categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
```

**Step 3: Update `updateCategory` to accept `rules`**

```typescript
export function updateCategory(id: number, data: { label?: string; color?: string; rules?: string | null }) {
  return request<{ category: Category }>(`/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
```

**Step 4: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add rules field to Category type and API functions"
```

---

### Task 6: Update CategoryManager UI with rules textarea

**Files:**
- Modify: `dashboard/src/components/CategoryManager.vue`

**Step 1: Add edit state for rules**

In the script setup section, after line 21 (`const editColor = ref('');`), add:

```typescript
const editRules = ref('');
```

After line 26 (`const newColor = ref(DEFAULT_CATEGORY_COLOR);`), add:

```typescript
const newRules = ref('');
```

**Step 2: Update `startEdit` to include rules**

```typescript
function startEdit(cat: Category) {
  editingId.value = cat.id;
  editLabel.value = cat.label;
  editColor.value = cat.color ?? DEFAULT_CATEGORY_COLOR;
  editRules.value = cat.rules ?? '';
}
```

**Step 3: Update `saveEdit` to send rules**

```typescript
async function saveEdit(cat: Category) {
  try {
    const res = await updateCategory(cat.id, {
      label: editLabel.value,
      color: editColor.value,
      rules: editRules.value || null,
    });
    const idx = categories.value.findIndex(c => c.id === cat.id);
    if (idx !== -1) categories.value[idx] = res.category;
    editingId.value = null;
  } catch {
    error.value = 'Failed to save';
  }
}
```

**Step 4: Update `addCategory` to send rules**

```typescript
const res = await createCategory({
  name: newName.value,
  label: newLabel.value,
  color: newColor.value,
  rules: newRules.value || undefined,
});
// ... after success, also reset:
newRules.value = '';
```

**Step 5: Add rules textarea to the "New category" form**

After the Color input div (around line 143), add:

```html
<div class="space-y-1 w-full">
  <label class="text-xs text-muted-foreground">Rules (LLM hint)</label>
  <textarea
    v-model="newRules"
    placeholder="Describe what transactions belong here. Include Hebrew merchant names if relevant."
    class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
  />
</div>
```

**Step 6: Add rules textarea to the inline edit form**

In the edit mode template (inside the `v-if="editingId === cat.id"` block, around line 178-188), expand the edit form to show a rules textarea. Replace the existing edit template:

```html
<template v-if="editingId === cat.id">
  <div class="space-y-2">
    <div class="flex gap-2 items-center">
      <Input v-model="editLabel" class="w-32 h-7 text-sm" />
      <input type="color" v-model="editColor" class="h-7 w-10 rounded border cursor-pointer" />
      <button @click="saveEdit(cat)" class="text-green-600 hover:text-green-700">
        <Check class="h-4 w-4" />
      </button>
      <button @click="cancelEdit" class="text-muted-foreground hover:text-foreground">
        <X class="h-4 w-4" />
      </button>
    </div>
    <textarea
      v-model="editRules"
      placeholder="LLM categorization rules..."
      class="w-full rounded-md border border-input bg-background px-2 py-1 text-xs min-h-[40px] resize-y"
    />
  </div>
</template>
```

**Step 7: Add a "Rules" column to the table**

Add a new `<TableHead>` after Label: `<TableHead>Rules</TableHead>`

Add a new `<TableCell>` after the Label cell to show rules in non-edit mode:

```html
<TableCell class="text-xs text-muted-foreground max-w-[200px] truncate" :title="cat.rules ?? ''">
  {{ cat.rules ?? '—' }}
</TableCell>
```

Update the colspan on the loading row from 4 to 5.

**Step 8: Commit**

```bash
git add dashboard/src/components/CategoryManager.vue
git commit -m "feat: add rules field to CategoryManager UI"
```

---

### Task 7: Verify end-to-end

**Step 1: Start the dev server**

Run: `npm run dev`
Expected: Server starts, migration runs, backfill creates 25 categories

**Step 2: Check categories in the UI**

Open the CategoryManager page. Verify:
- 25 categories listed with labels, colors, and rules
- Can edit rules for a category and save
- Can create a new category with rules

**Step 3: Test categorization**

Trigger a recategorization on a small date range. Verify:
- LLM prompt includes per-category rules
- Transactions are categorized correctly

**Step 4: Commit any fixes**

```bash
git commit -m "fix: address issues found in e2e verification"
```
