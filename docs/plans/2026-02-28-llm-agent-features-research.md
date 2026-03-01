# LLM Agent Features Research

## Date: 2026-02-28

---

## Table of Contents

1. [Project Analysis: What We Have Today](#1-project-analysis-what-we-have-today)
2. [Data We Collect & Underutilized Data](#2-data-we-collect--underutilized-data)
3. [Competitive Landscape](#3-competitive-landscape)
4. [Feature Recommendations for the LLM Agent](#4-feature-recommendations-for-the-llm-agent)
5. [UX Improvements for the AI Chat](#5-ux-improvements-for-the-ai-chat)
6. [Priority Roadmap](#6-priority-roadmap)

---

## 1. Project Analysis: What We Have Today

### Current AI Agent Capabilities

The Money Monitor AI agent is built on the **Anthropic Claude Agent SDK** with an in-process MCP server (`financial-tools`). It has **4 tools**:

| Tool | Purpose | Data Access |
|------|---------|-------------|
| `query_transactions` | Search/filter transactions | Filters by account, date, category, status, amount, description search. Max 200 results |
| `get_spending_summary` | Aggregated spending | Groups by category, month, or account. SUM + COUNT |
| `categorize_transaction` | Assign category to one transaction | Direct DB write |
| `get_account_balances` | List accounts with stats | Account details + computed transaction count and total spending |

### Current Agent Limitations

1. **No persistent conversation history** -- conversations reset on page reload
2. **Max 10 turns** per chat -- complex multi-step analysis can hit this limit
3. **No budget awareness** -- the agent cannot reference budgets or goals
4. **No recurring transaction detection** -- cannot identify subscriptions or repeated charges
5. **No trend analysis tools** -- must compute trends manually from raw data each time
6. **No merchant normalization** -- "AMZN MKTPLACE 123" stays as-is, not mapped to "Amazon"
7. **No time-based comparison tool** -- month-over-month requires multiple tool calls
8. **Read-only except categorization** -- cannot set budgets, create goals, or annotate transactions
9. **No proactive insights** -- only responds when asked, never pushes notifications
10. **Stateless** -- no memory of past conversations or user preferences

---

## 2. Data We Collect & Underutilized Data

### Data Currently Stored

| Field | Used By Agent? | Used By Dashboard? | Potential |
|-------|---------------|-------------------|-----------|
| `date` | Yes (filter) | Yes | Trend analysis, day-of-week patterns |
| `processedDate` | No | No | Processing delay analysis |
| `originalAmount` | No | No | Currency conversion tracking |
| `originalCurrency` | No | No | Foreign spending analysis |
| `chargedAmount` | Yes (filter, sum) | Yes | Core metric |
| `description` | Yes (search) | Yes | Merchant extraction, NLP |
| `memo` | No | No | Additional context for categorization |
| `type` (normal/installments) | No | No | Installment plan tracking |
| `installmentNumber` | No | No | Future payment obligations |
| `installmentTotal` | No | No | Total commitment tracking |
| `category` | Yes | Yes | Core feature |
| `meta.bankCategory` | No | No | Cross-reference with AI categorization |
| `status` (completed/pending) | Yes (filter) | Yes (badge) | Pending spend forecasting |
| `ignored` | No (excluded) | Yes (dimmed) | Pattern of ignored items |
| `balance` (on accounts) | Not exposed | Partially | Net worth, balance trends |
| `scrape_logs.durationMs` | No | No | System health monitoring |
| `scrape_logs.transactionsNew` | No | No | Data freshness tracking |

### Key Underutilized Data Opportunities

1. **`installmentNumber` + `installmentTotal`** -- Can predict future payment obligations and total committed spend
2. **`originalCurrency` + `originalAmount`** -- Can analyze foreign spending patterns (travel, online shopping)
3. **`meta.bankCategory`** -- Bank-provided categories can cross-validate AI categorization or serve as fallback
4. **`processedDate` vs `date`** -- Processing delays can flag unusual transactions
5. **`balance` on accounts** -- Currently not tracked historically; could enable net worth trending
6. **`description` NLP** -- Merchant name extraction, location detection, chain vs local business classification

---

## 3. Competitive Landscape

### Israeli Market

| Product | Type | AI Features | Differentiation |
|---------|------|------------|-----------------|
| **[Caspion](https://github.com/brafdlog/caspion)** | Desktop GUI (Electron) | None. Rule-based categorization via `categoryCalculationScript.js` | Same scraper library. Exports to Sheets/YNAB/CSV. No backend, no dashboard, no AI |
| **[Moneyman](https://github.com/daniel-hauser/moneyman)** | Headless (GitHub Actions/Docker) | None | Auto-scrapes via CI. Exports to Actual Budget, YNAB, Sheets. Developer-oriented, no UI |
| **[RiseUp](https://www.letsriseup.com/)** | Commercial mobile app | Cash-flow forecasting, spending predictions, subscription detection, smart savings nudges | 45 NIS/mo. Uses Open Banking API (not scraping). 100k+ users. WhatsApp consultation |
| **[Finanda](https://www.finanda.com/en/)** | Commercial mobile app | Proprietary categorization algorithm | Free/16 NIS/mo. Licensed aggregator. More accurate categorization than RiseUp |
| **[IL Bank MCP servers](https://github.com/glekner/il-bank-mcp)** | MCP bridge | Thin bridge for external AI clients | Allows Claude Desktop / Cursor to query Israeli bank data directly |

**Money Monitor's unique position**: The only tool combining Israeli bank scraping + self-hosted backend + structured DB + REST API + dashboard + AI agent in one open-source package. Caspion/Moneyman lack AI; RiseUp/Finanda are proprietary cloud services.

### Global AI Finance Leaders

#### Monarch Money ($99.99/year, web + mobile)
- **AI Assistant**: Natural language chat backed by actual financial data, guided by in-house CFPs
- **AI Insights**: Proactive sparkle icons throughout the app that explain financial changes contextually
- **Weekly Recap**: Automated weekly summary with trend analysis and actionable highlights
- **Receipt Scanning**: Upload receipt photo, AI matches to transaction and splits line items
- **Household Context**: AI tailors advice based on dependents, income, tax filing status
- **Auto-categorization**: Always-on, learns from corrections
- **Privacy**: Enterprise agreements with LLM providers; minimal data shared; no training on user data

#### Cleo AI (Free/$5.99-$14.99/mo, mobile)
- **Cleo 3.0 (July 2025)**: First AI money coach with voice, memory, and reasoning
- **Dynamic Memory**: Remembers goals, habits, financial history across sessions
- **Advanced Reasoning**: Powered by OpenAI o3/GPT-4o; complex financial decisions become actionable steps
- **Voice Conversations**: Two-way voice with personality (Roast Mode, Hype Mode)
- **Behavioral Coaching**: Gamified challenges, financial trivia, spending critiques
- **Autosave**: AI-driven micro-savings based on cash flow analysis
- **Scale**: 14 billion+ transactions analyzed, $250M ARR, near-profitable

#### Copilot Money ($95/year, iOS/macOS only)
- **Adaptive Budgets**: ML learns spending habits and auto-rebalances budget categories
- **Smart Rebalancing**: Shifts budget dollars to match actual behavior patterns
- **Recurring Detection**: Automatically identifies subscriptions and recurring charges
- **Fraud Alerts**: Proactive suspicious activity notifications
- **90% accurate categorization** out of the box, improving with feedback
- **Natural Language Search**: Query transactions conversationally

#### YNAB ($109/year, web + mobile)
- **No native AI** in the core product
- **Rich third-party AI ecosystem**: FinInsights (expense forecasting), multiple MCP servers, receipt AI tools
- **Philosophy**: Zero-based envelope budgeting -- intentional and manual by design

#### Lunch Money (~$50-60/year, web-first)
- **No native AI** but strong developer API
- **Community-built MCP server** for AI agent integration
- **Best multi-currency support** in the market
- **Privacy-first**: Solo developer, no investors, no data selling

### Self-Hosted / Open-Source

| Product | Key Strengths | AI Features |
|---------|--------------|-------------|
| **[Firefly III](https://www.firefly-iii.org/)** | Most feature-complete self-hosted. Double-entry bookkeeping. REST API. Rules engine | None native. Community MCP server exists |
| **[Actual Budget](https://actualbudget.org/)** | Local-first, E2E encrypted sync, fast. Envelope budgeting | None. Has developer API |
| **[GnuCash](https://www.gnucash.org/)** | Mature (since 1998). Full accounting. Investment tracking | None |
| **[Maybe Finance](https://github.com/maybe-finance/maybe)** (archived) | Had AI chat via OpenAI. Balance trends. 45k GitHub stars | AI chat (before archival July 2025). Fork "Sure" continues |

### MCP Ecosystem Growth

MCP servers already exist for: Monarch Money, YNAB, Lunch Money, Pocketsmith, Israeli Bank Scrapers, Firefly III, FactSet, Microsoft Dynamics 365, and Narmi Banking. This signals a strong industry trend toward standardized AI-to-finance-tool connectivity.

---

## 4. Feature Recommendations for the LLM Agent

### Tier 1: High-Impact New Tools (add to MCP server)

#### 1.1 `detect_recurring_transactions`
**What**: Analyze transaction history to identify recurring charges (subscriptions, memberships, bills).
**Why**: One of the most requested features across all finance apps. Copilot, Cleo, and Monarch all offer this. Helps users find forgotten subscriptions and predict upcoming bills.
**How it works**:
- Group transactions by normalized description
- Detect regular intervals (weekly, monthly, annual)
- Return: merchant name, amount, frequency, next expected date, total annual cost
- Flag changes (price increases, new subscriptions, cancelled ones)

**Data needed**: Existing `description`, `chargedAmount`, `date` fields. No schema changes.

#### 1.2 `compare_periods`
**What**: Compare spending between two time periods with detailed breakdown.
**Why**: Currently requires multiple tool calls and manual computation. This is the #1 type of question users ask ("How does this month compare to last month?").
**Returns**: Side-by-side comparison with delta amounts and percentages per category, total change, biggest increases/decreases.

**Data needed**: Existing data. No schema changes.

#### 1.3 `get_spending_trends`
**What**: Calculate trends over N months for specific categories or overall.
**Why**: Enables the agent to answer "Is my food spending going up?" without multiple round-trips.
**Returns**: Monthly totals over time, trend direction (increasing/decreasing/stable), average, min, max, standard deviation, projected next month.

**Data needed**: Existing data. No schema changes.

#### 1.4 `get_top_merchants`
**What**: Extract and rank merchants by total spend, frequency, or average transaction size.
**Why**: Users frequently ask "Where do I spend the most?" -- currently the agent can only search by description text, not aggregate by merchant.
**How**: Normalize descriptions (strip transaction IDs, dates, card numbers), group by normalized merchant name, rank by total/count.

**Data needed**: Existing `description` field. Consider adding a `merchant` column for cached normalization.

#### 1.5 `get_installment_obligations`
**What**: Calculate outstanding installment payment obligations.
**Why**: Common in Israel (Tashlumim). Currently `installmentNumber` and `installmentTotal` are stored but completely unused.
**Returns**: Active installment plans, remaining payments, total future obligation, monthly installment burden.

**Data needed**: Existing `installmentNumber`, `installmentTotal`, `chargedAmount` fields. No schema changes.

#### 1.6 `get_foreign_currency_spending`
**What**: Analyze spending in foreign currencies.
**Why**: `originalCurrency` and `originalAmount` are stored but never used by the agent. Israeli users frequently have USD/EUR transactions.
**Returns**: Breakdown by currency, exchange rate impact, total foreign spend.

**Data needed**: Existing `originalCurrency`, `originalAmount`, `chargedAmount` fields. No schema changes.

#### 1.7 `annotate_transaction`
**What**: Add a user note/tag to a transaction (beyond category).
**Why**: Let the agent remember context. "This was a birthday gift" or "Reimbursable work expense". Currently the agent can only categorize.
**How**: Add a `notes` text column to transactions, or use the existing `memo` field.

**Data needed**: Minor schema addition (or use existing `memo`).

### Tier 2: Intelligence Features (enhance agent behavior)

#### 2.1 Proactive Anomaly Detection
**What**: Tool that scans recent transactions for anomalies -- unusually large charges, duplicate charges, unexpected merchants, charges at unusual times.
**Why**: Monarch's "AI Insights" and Copilot's "Fraud Alerts" are highly valued features. The agent should be able to flag issues proactively.
**Tool name**: `detect_anomalies`
**Returns**: List of flagged transactions with reason (unusual amount, duplicate, new merchant, etc.).

#### 2.2 Cash Flow Forecasting
**What**: Based on recurring transactions, pending transactions, and historical patterns, project the next 30/60/90 days of income and expenses.
**Why**: RiseUp's core differentiator. FinInsights for YNAB offers this. Users want to know "Will I have enough this month?"
**Tool name**: `forecast_cashflow`
**Returns**: Projected daily/weekly/monthly balances, expected income, expected expenses, surplus/deficit.

#### 2.3 Budget Recommendations
**What**: Based on 3+ months of spending history, suggest realistic budget targets per category.
**Why**: Copilot's "Smart Rebalancing" is their standout feature. Users struggle to set realistic budgets.
**Tool name**: `suggest_budgets`
**Returns**: Recommended amount per category based on historical average, median, and trend. Flags categories with high variance.

**Prerequisite**: Needs a `budgets` table to store targets. But the tool itself could work without one by just returning suggestions.

#### 2.4 Savings Opportunities Finder
**What**: Identify potential savings: subscription overlaps, price increases, category overspending vs peers, cheaper alternatives.
**Why**: Cleo's value proposition. Users want actionable "You could save ₪X by..."
**Tool name**: `find_savings_opportunities`
**Returns**: List of actionable recommendations with estimated monthly savings.

#### 2.5 Smart Transaction Search
**What**: Enhanced search that understands intent, not just literal text matching.
**Why**: Current search is `LIKE '%term%'` -- misses plurals, abbreviations, Hebrew/English mixing.
**Examples**: "Amazon" should match "AMZN MKTPLACE", "restaurant" should match "CAFE", "רמי לוי" should match variations.
**How**: Build a merchant alias table or use the LLM to generate search variants.

### Tier 3: Platform Capabilities (new infrastructure)

#### 3.1 Persistent Conversation History
**What**: Store chat conversations server-side with session IDs.
**Why**: Currently conversations are lost on page reload. Monarch and Cleo both maintain conversation memory.
**Schema**: New `conversations` and `chat_messages` tables.
**Benefit**: Agent can reference past discussions, user can resume conversations, enables conversation analytics.

#### 3.2 User Preferences / Memory
**What**: Let the agent store and recall user preferences and financial context.
**Why**: Cleo 3.0's "Dynamic Memory" is their flagship feature. Knowing "user is saving for a car" or "user wants to reduce food spending" enables personalized advice.
**Schema**: New `user_preferences` table (key-value or structured).
**Examples**:
- Financial goals (save ₪10,000 for vacation)
- Budget preferences (wants to keep food under ₪3,000/mo)
- Household context (2 adults, 1 child)
- Income schedule (paid on the 9th and 23rd)

#### 3.3 Scheduled AI Reports
**What**: Automated weekly/monthly financial summary generated by the agent.
**Why**: Monarch's "Weekly Recap" is a beloved feature. Removes friction -- user doesn't have to ask.
**How**: Cron job triggers agent with a standardized prompt, stores result, surfaces in dashboard or sends via notification.

#### 3.4 MCP Server Exposure
**What**: Expose Money Monitor's financial tools as an MCP server that external AI clients (Claude Desktop, Cursor, etc.) can connect to.
**Why**: The MCP ecosystem is exploding. Users already build MCP servers for YNAB, Monarch, Lunch Money, and Firefly III. This would make Money Monitor data accessible to any AI assistant, not just the built-in chat.
**How**: Serve an MCP endpoint alongside the REST API. Reuse existing tool definitions.

#### 3.5 Multi-Model Support
**What**: Allow users to configure different LLM providers (Anthropic, OpenAI, local Ollama models).
**Why**: Privacy-conscious users want local inference. Cost-conscious users may want cheaper models for simple categorization. The trend toward local LLMs (Ollama, AnythingLLM) is strong in the self-hosted community.

---

## 5. UX Improvements for the AI Chat

### 5.1 Conversation Persistence
- Save conversations to database with timestamps
- Show conversation history in sidebar
- Allow resuming past conversations
- "New conversation" button

### 5.2 Richer Starter Suggestions
Current suggestions are generic. Improve with **contextual suggestions** based on actual data:
- "You have 47 uncategorized transactions -- want me to categorize them?"
- "Your food spending jumped 35% this month -- want to see why?"
- "You have 3 new recurring charges -- want to review them?"
- "Your installment payments total ₪2,400/month -- want a breakdown?"

### 5.3 Inline Data Visualization
When the agent returns structured data (spending by category, monthly trends), render it as a chart directly in the chat, not just text/tables.
- Pie charts for category breakdowns
- Bar charts for month comparisons
- Line charts for trends
- Transaction lists with interactive filters

### 5.4 Quick Actions
Add action buttons to agent responses:
- "Categorize all" button when agent mentions uncategorized transactions
- "Ignore" button next to flagged transactions
- "Set budget" button next to budget recommendations
- "Show details" button to expand a summary into transaction list

### 5.5 Streaming Responses
Stream agent responses token-by-token for better perceived performance. Show tool call activity ("Querying transactions...", "Analyzing spending patterns...").

### 5.6 Voice Input (Future)
Cleo 3.0's voice interaction is their flagship feature. For a web app, browser speech-to-text API could provide hands-free financial queries.

### 5.7 Financial Health Score
Display a computed "financial health" score on the dashboard based on:
- Savings rate (income - expenses / income)
- Budget adherence
- Emergency fund coverage
- Debt-to-income ratio
- Spending trend direction

The agent could explain the score and suggest improvements.

---

## 6. Priority Roadmap

### Phase A: Quick Wins (1-2 days each, no schema changes)

| # | Feature | Impact | Effort |
|---|---------|--------|--------|
| A1 | `compare_periods` tool | High -- most common question type | Low |
| A2 | `get_spending_trends` tool | High -- enables trend answers | Low |
| A3 | `detect_recurring_transactions` tool | High -- universally requested | Medium |
| A4 | `get_top_merchants` tool | Medium -- popular question type | Low |
| A5 | `get_installment_obligations` tool | Medium -- Israeli market specific | Low |
| A6 | `get_foreign_currency_spending` tool | Medium -- Israeli market specific | Low |
| A7 | Contextual chat suggestions | Medium -- better first-use experience | Low |

### Phase B: Core Intelligence (3-5 days each)

| # | Feature | Impact | Effort |
|---|---------|--------|--------|
| B1 | Persistent conversation history | High -- retention and UX | Medium |
| B2 | `detect_anomalies` tool | High -- trust-building feature | Medium |
| B3 | `forecast_cashflow` tool | High -- key competitor differentiator | Medium |
| B4 | `suggest_budgets` tool | Medium -- requires budget infrastructure | Medium |
| B5 | Streaming responses | Medium -- perceived performance | Medium |
| B6 | Inline chart rendering in chat | Medium -- data comprehension | Medium |

### Phase C: Platform Features (1-2 weeks each)

| # | Feature | Impact | Effort |
|---|---------|--------|--------|
| C1 | User preferences / memory | High -- personalization | High |
| C2 | Scheduled AI reports (weekly recap) | High -- engagement driver | High |
| C3 | MCP server exposure | High -- ecosystem integration | Medium |
| C4 | Budget system (tables + tools + UI) | High -- core finance feature | High |
| C5 | Merchant normalization table | Medium -- data quality | Medium |
| C6 | Multi-model support (Ollama etc.) | Medium -- self-hosted appeal | High |

### Phase D: Differentiators (ongoing)

| # | Feature | Impact | Effort |
|---|---------|--------|--------|
| D1 | `find_savings_opportunities` tool | High -- actionable value | Medium |
| D2 | Financial health score | Medium -- engagement | Medium |
| D3 | Voice input | Medium -- accessibility | Medium |
| D4 | Smart search (merchant aliases) | Medium -- search quality | Medium |
| D5 | Quick action buttons in chat | Medium -- reduce friction | Medium |

---

## Sources

### Israeli Finance Tools
- [israeli-bank-scrapers (GitHub)](https://github.com/eshaham/israeli-bank-scrapers)
- [Caspion (GitHub)](https://github.com/brafdlog/caspion)
- [Moneyman (GitHub)](https://github.com/daniel-hauser/moneyman)
- [IL Bank MCP (GitHub)](https://github.com/glekner/il-bank-mcp)
- [RiseUp](https://www.letsriseup.com/)
- [Finanda](https://www.finanda.com/en/)

### AI Finance Apps
- [Monarch Money AI Features](https://help.monarch.com/hc/en-us/articles/16116906962452-About-Monarch-s-AI-Features)
- [Monarch Winter Release](https://www.monarch.com/blog/winter-release)
- [Cleo 3.0 Launch](https://www.businesswire.com/news/home/20250729690058/en/Cleo-Becomes-the-First-AI-Money-Coach-That-Speaks-Thinks-and-Remembers)
- [Copilot Money](https://www.copilot.money/)
- [Copilot Intelligence](https://intelligence.copilot.money/)
- [Copilot Review 2026](https://moneywithkatie.com/copilot-review-a-budgeting-app-that-finally-gets-it-right/)
- [FinInsights for YNAB](https://methodicalcloud.com/blog/announcing-fininsights-beta-ai-intelligence-ynab)
- [Lunch Money](https://lunchmoney.app/)

### Self-Hosted & Open Source
- [Firefly III](https://www.firefly-iii.org/)
- [Actual Budget](https://actualbudget.org/)
- [GnuCash](https://www.gnucash.org/)

### MCP & AI Trends
- [MCP Specification (Nov 2025)](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP for Finance (Daloopa)](https://daloopa.com/blog/analyst-best-practices/the-mcp-revolution-how-model-context-protocol-will-transform-finance-roles)
- [MCP for Fintech (Prometeo)](https://prometeoapi.com/en/blog/model-context-protocol-fintech)
- [AI Financial Assistants Trend](https://canaltecnotudo.com/en/the-new-wave-of-ai-financial-assistants-how-apps-like-copilot-money-cleo-and-monarch-are-transforming-budgeting-in-2025-2026/)
- [Narmi MCP Banking](https://www.narmi.com/insights/driving-personal-financial-management-with-the-power-of-ai)
