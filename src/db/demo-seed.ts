import { randomUUID } from 'node:crypto';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import * as schema from './schema.js';

/**
 * Populate a demo database with realistic Israeli financial data.
 * Idempotent — skips seeding if accounts already exist.
 */
export function seedDemoData(
  db: BetterSQLite3Database<typeof schema>,
  sqlite: BetterSqlite3Database,
): void {
  // Skip if already seeded
  const existing = db.select({ id: schema.accounts.id }).from(schema.accounts).all();
  if (existing.length > 0) return;

  sqlite.transaction(() => {
    // ─── Accounts ───
    const dummyRef = randomUUID();

    const accountRows = [
      { companyId: 'hapoalim', displayName: 'Bank Hapoalim - Checking', accountNumber: '123456', accountType: 'bank' as const, balance: 24350.80, credentialsRef: dummyRef },
      { companyId: 'leumi', displayName: 'Bank Leumi - Savings', accountNumber: '789012', accountType: 'bank' as const, balance: 85200.00, credentialsRef: dummyRef },
      { companyId: 'isracard', displayName: 'Isracard Platinum', accountNumber: '4580', accountType: 'credit_card' as const, balance: -3420.50, credentialsRef: dummyRef },
      { companyId: 'max', displayName: 'Max Visa', accountNumber: '9210', accountType: 'credit_card' as const, balance: -1850.30, credentialsRef: dummyRef },
    ];

    const accountIds: number[] = [];
    for (const a of accountRows) {
      const result = db.insert(schema.accounts).values({
        ...a,
        isActive: true,
        lastScrapedAt: formatDate(daysAgo(1)),
      }).returning({ id: schema.accounts.id }).get();
      accountIds.push(result.id);
    }

    const [hapoalimId, leumiId] = accountIds;

    // ─── Transactions ───
    // Generate ~200 transactions over the last 6 months

    const txTemplates: Array<{ description: string; category: string; minAmount: number; maxAmount: number; accountIdx: number }> = [
      // Groceries
      { description: 'שופרסל דיל - סניף העיר', category: 'groceries', minAmount: -80, maxAmount: -450, accountIdx: 2 },
      { description: 'רמי לוי שיווק', category: 'groceries', minAmount: -120, maxAmount: -380, accountIdx: 2 },
      { description: 'יוחננוף', category: 'groceries', minAmount: -60, maxAmount: -300, accountIdx: 3 },
      { description: 'AM:PM', category: 'groceries', minAmount: -15, maxAmount: -80, accountIdx: 2 },
      { description: 'טיב טעם', category: 'groceries', minAmount: -50, maxAmount: -250, accountIdx: 3 },
      // Restaurants
      { description: "ג'פניקה - רמת אביב", category: 'restaurants', minAmount: -60, maxAmount: -180, accountIdx: 2 },
      { description: "דומינו'ס פיצה", category: 'restaurants', minAmount: -55, maxAmount: -120, accountIdx: 3 },
      { description: 'WOLT', category: 'restaurants', minAmount: -40, maxAmount: -130, accountIdx: 2 },
      { description: 'תן ביס - ארוחת צהריים', category: 'restaurants', minAmount: -35, maxAmount: -75, accountIdx: 3 },
      { description: 'שיפודי הכיכר', category: 'restaurants', minAmount: -80, maxAmount: -250, accountIdx: 2 },
      // Cafe & Bar
      { description: 'ארומה תל אביב', category: 'cafe-bar', minAmount: -18, maxAmount: -45, accountIdx: 2 },
      { description: 'קופיקס', category: 'cafe-bar', minAmount: -10, maxAmount: -30, accountIdx: 3 },
      { description: 'לנדוור קפה', category: 'cafe-bar', minAmount: -22, maxAmount: -55, accountIdx: 2 },
      // Fuel
      { description: 'דלק - תחנת פז', category: 'fuel', minAmount: -150, maxAmount: -350, accountIdx: 2 },
      { description: 'סונול - תחנת דלק', category: 'fuel', minAmount: -180, maxAmount: -320, accountIdx: 3 },
      // Transport
      { description: 'רב-קו טעינה', category: 'public-transport', minAmount: -50, maxAmount: -150, accountIdx: 2 },
      { description: 'Gett מונית', category: 'public-transport', minAmount: -25, maxAmount: -80, accountIdx: 3 },
      // Parking
      { description: 'פנגו חניה', category: 'parking', minAmount: -8, maxAmount: -35, accountIdx: 2 },
      // Utilities
      { description: 'חברת החשמל', category: 'utilities', minAmount: -200, maxAmount: -650, accountIdx: 0 },
      { description: 'ארנונה - עירייה', category: 'utilities', minAmount: -350, maxAmount: -800, accountIdx: 0 },
      { description: 'מקורות - מים', category: 'utilities', minAmount: -80, maxAmount: -200, accountIdx: 0 },
      { description: 'ועד בית', category: 'utilities', minAmount: -250, maxAmount: -400, accountIdx: 0 },
      { description: 'HOT - אינטרנט', category: 'utilities', minAmount: -120, maxAmount: -180, accountIdx: 2 },
      { description: 'פלאפון - חשבון חודשי', category: 'utilities', minAmount: -60, maxAmount: -120, accountIdx: 2 },
      // Health
      { description: 'סופר-פארם', category: 'health', minAmount: -30, maxAmount: -150, accountIdx: 2 },
      { description: 'מכבי שירותי בריאות', category: 'health', minAmount: -50, maxAmount: -200, accountIdx: 0 },
      // Fitness
      { description: 'Holmes Place - מנוי חודשי', category: 'fitness', minAmount: -280, maxAmount: -350, accountIdx: 2 },
      // Clothing
      { description: 'FOX', category: 'clothing', minAmount: -80, maxAmount: -300, accountIdx: 3 },
      { description: 'H&M', category: 'clothing', minAmount: -60, maxAmount: -250, accountIdx: 2 },
      { description: 'קסטרו', category: 'clothing', minAmount: -100, maxAmount: -400, accountIdx: 3 },
      // Shopping
      { description: 'AliExpress', category: 'shopping', minAmount: -30, maxAmount: -200, accountIdx: 2 },
      { description: 'KSP מחשבים', category: 'shopping', minAmount: -100, maxAmount: -800, accountIdx: 3 },
      { description: 'Amazon', category: 'shopping', minAmount: -50, maxAmount: -400, accountIdx: 2 },
      // Subscriptions
      { description: 'Netflix', category: 'subscriptions', minAmount: -45, maxAmount: -55, accountIdx: 2 },
      { description: 'Spotify', category: 'subscriptions', minAmount: -20, maxAmount: -30, accountIdx: 2 },
      { description: 'ChatGPT Plus', category: 'subscriptions', minAmount: -75, maxAmount: -75, accountIdx: 3 },
      { description: 'Apple iCloud', category: 'subscriptions', minAmount: -10, maxAmount: -15, accountIdx: 2 },
      // Entertainment
      { description: 'סינמה סיטי', category: 'entertainment', minAmount: -40, maxAmount: -120, accountIdx: 3 },
      { description: 'פייבוקס - כרטיסי הופעה', category: 'entertainment', minAmount: -150, maxAmount: -400, accountIdx: 2 },
      // Insurance
      { description: 'ביטוח רכב - הראל', category: 'insurance', minAmount: -300, maxAmount: -450, accountIdx: 0 },
      { description: 'ביטוח דירה', category: 'insurance', minAmount: -80, maxAmount: -150, accountIdx: 0 },
      // Education
      { description: 'Udemy - קורס', category: 'education', minAmount: -40, maxAmount: -100, accountIdx: 2 },
      // Gifts
      { description: 'מתנה - יום הולדת', category: 'gifts', minAmount: -100, maxAmount: -400, accountIdx: 3 },
      // House expenses
      { description: 'IKEA', category: 'house-expenses', minAmount: -200, maxAmount: -1500, accountIdx: 3 },
    ];

    // Fixed monthly transactions
    const monthlyFixed = [
      { description: 'משכורת', category: 'income', amount: 18500, accountIdx: 0 },
      { description: 'שכר דירה', category: 'rent', amount: -4500, accountIdx: 0 },
      { description: 'הלוואה - משכנתא', category: 'loans', amount: -3200, accountIdx: 0 },
      { description: 'קרן השתלמות', category: 'savings', amount: -1500, accountIdx: 0 },
      { description: 'העברה לחסכון', category: 'transfer', amount: -2000, accountIdx: 0 },
    ];

    const now = new Date();

    // Generate 6 months of fixed monthly transactions
    for (let monthBack = 0; monthBack < 6; monthBack++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - monthBack, 1);

      for (const fixed of monthlyFixed) {
        const day = fixed.category === 'income' ? 10 : (fixed.category === 'rent' ? 1 : 5);
        const txDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
        if (txDate > now) continue;

        const dateStr = formatDate(txDate);
        db.insert(schema.transactions).values({
          accountId: accountIds[fixed.accountIdx],
          date: dateStr,
          processedDate: dateStr,
          originalAmount: fixed.amount,
          originalCurrency: 'ILS',
          chargedAmount: fixed.amount,
          description: fixed.description,
          type: 'normal',
          status: 'completed',
          category: fixed.category,
          confidence: 0.95,
          hash: randomUUID(),
        }).run();
      }
    }

    // Generate variable transactions (~25-35 per month)
    for (let monthBack = 0; monthBack < 6; monthBack++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - monthBack, 1);
      const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
      const txPerMonth = 25 + Math.floor(seededRandom(monthBack * 100) * 10);

      for (let i = 0; i < txPerMonth; i++) {
        const template = txTemplates[Math.floor(seededRandom(monthBack * 1000 + i) * txTemplates.length)];
        const day = 1 + Math.floor(seededRandom(monthBack * 2000 + i) * (daysInMonth - 1));
        const txDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
        if (txDate > now) continue;

        const range = template.maxAmount - template.minAmount;
        const amount = Math.round((template.minAmount + seededRandom(monthBack * 3000 + i) * range) * 100) / 100;
        const dateStr = formatDate(txDate);

        db.insert(schema.transactions).values({
          accountId: accountIds[template.accountIdx],
          date: dateStr,
          processedDate: dateStr,
          originalAmount: amount,
          originalCurrency: 'ILS',
          chargedAmount: amount,
          description: template.description,
          type: 'normal',
          status: 'completed',
          category: template.category,
          confidence: 0.9,
          hash: randomUUID(),
        }).run();
      }
    }

    // Backfill FTS index for demo transactions
    sqlite.exec(`
      INSERT OR IGNORE INTO transactions_fts(rowid, description, memo)
      SELECT id, description, COALESCE(memo, '') FROM transactions
    `);

    // ─── Assets ───

    // Brokerage account
    const brokerage = db.insert(schema.assets).values({
      name: 'תיק השקעות - IBI',
      type: 'brokerage',
      institution: 'IBI',
      currency: 'ILS',
      liquidity: 'liquid',
    }).returning({ id: schema.assets.id }).get();

    // Holdings
    const holdingsData = [
      { assetId: brokerage.id, name: 'S&P 500 ETF', type: 'etf', currency: 'USD', quantity: 15, costBasis: 58500, lastPrice: 4250, lastPriceDate: formatDate(daysAgo(1)) },
      { assetId: brokerage.id, name: 'אג"ח ממשלתי 0526', type: 'bond', currency: 'ILS', quantity: 50000, costBasis: 48500, lastPrice: 1.02, lastPriceDate: formatDate(daysAgo(1)) },
      { assetId: brokerage.id, name: 'קרן כספית', type: 'fund', currency: 'ILS', quantity: 30000, costBasis: 30000, lastPrice: 1.04, lastPriceDate: formatDate(daysAgo(1)) },
    ];

    for (const h of holdingsData) {
      db.insert(schema.holdings).values(h).run();
    }

    // Real estate
    const realEstate = db.insert(schema.assets).values({
      name: 'דירת השקעה - חיפה',
      type: 'real_estate',
      currency: 'ILS',
      liquidity: 'locked',
    }).returning({ id: schema.assets.id }).get();

    db.insert(schema.holdings).values({
      assetId: realEstate.id,
      name: 'שווי נכס',
      type: 'property',
      currency: 'ILS',
      quantity: 1,
      costBasis: 950000,
      lastPrice: 1150000,
      lastPriceDate: formatDate(daysAgo(30)),
    }).run();

    // Asset snapshots (monthly for 6 months)
    for (let monthBack = 0; monthBack < 6; monthBack++) {
      const snapDate = new Date(now.getFullYear(), now.getMonth() - monthBack, 1);
      const dateStr = formatDate(snapDate);
      const brokerageGrowth = 1 + (5 - monthBack) * 0.015;
      const realEstateGrowth = 1 + (5 - monthBack) * 0.005;

      db.insert(schema.assetSnapshots).values({
        assetId: brokerage.id,
        date: dateStr,
        totalValueIls: Math.round(140000 * brokerageGrowth),
      }).run();

      db.insert(schema.assetSnapshots).values({
        assetId: realEstate.id,
        date: dateStr,
        totalValueIls: Math.round(1100000 * realEstateGrowth),
      }).run();
    }

    // ─── Liabilities ───

    db.insert(schema.liabilities).values({
      name: 'משכנתא - בנק הפועלים',
      type: 'mortgage',
      currency: 'ILS',
      originalAmount: 800000,
      currentBalance: 620000,
      interestRate: 3.5,
      startDate: '2021-03-01',
    }).run();

    // ─── Account Balance History ───

    for (let weekBack = 0; weekBack < 26; weekBack++) {
      const date = daysAgo(weekBack * 7);
      const dateStr = formatDate(date);

      const hapoalimBalance = 20000 + seededRandom(weekBack) * 10000;
      const leumiBalance = 80000 + weekBack * 200;

      db.insert(schema.accountBalanceHistory).values({
        accountId: hapoalimId,
        date: dateStr,
        balance: Math.round(hapoalimBalance * 100) / 100,
      }).run();

      db.insert(schema.accountBalanceHistory).values({
        accountId: leumiId,
        date: dateStr,
        balance: Math.round(leumiBalance * 100) / 100,
      }).run();
    }
  })();
}

// ─── Helpers ───

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Simple seeded pseudo-random for deterministic data */
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}
