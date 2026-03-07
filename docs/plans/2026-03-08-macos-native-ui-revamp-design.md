# macOS Native UI Revamp - Design Document

**Date**: 2026-03-08
**Status**: Approved
**Approach**: Full Native Overhaul (Approach A)

## Summary

Complete redesign of the Money Monitor Electron app UI to match macOS native design language (macOS 26 Tahoe / Liquid Glass era). The app should feel indistinguishable from a native macOS application.

## Key Decisions

- **Color mode**: Follow system preference (light + dark mode via `prefers-color-scheme`)
- **Accent color**: Read from macOS system preferences via Electron API
- **Sidebar**: Always visible, fixed 220px width, native vibrancy material
- **Vibrancy**: Native Electron vibrancy API (not CSS approximation)
- **Typography**: SF Pro system font at 13px base (remove Google Fonts)

---

## 1. Foundation

### Window Chrome (Electron Main Process)

```javascript
const win = new BrowserWindow({
  titleBarStyle: 'hiddenInset',
  trafficLightPosition: { x: 20, y: 19 },
  vibrancy: 'sidebar',
  visualEffectState: 'followWindow',
  backgroundColor: '#00000000',
})
```

- Listen for `nativeTheme.updated` to sync background color
- Listen for `focus`/`blur` to send window state to renderer
- Read `systemPreferences.getAccentColor()` and send to renderer as CSS custom property

### Typography

- **Remove** Geist and DM Sans Google Font imports
- System font stack: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`
- Monospace: `ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace`
- **Base size: 13px**
- Scale: Large Title 26px, Title 1 22px, Title 2 17px, Title 3 15px, Headline 13px bold, Body 13px, Callout 12px, Footnote 10px
- `-webkit-font-smoothing: antialiased`

### Color System

Semantic tokens that switch via `prefers-color-scheme`. Remove hardcoded `class="dark"` from HTML.

| Token | Light | Dark |
|-------|-------|------|
| `--bg-primary` | `#FFFFFF` | `#1C1C1E` |
| `--bg-secondary` | `#F5F5F7` | `#2C2C2E` |
| `--bg-tertiary` | `#E5E5EA` | `#3A3A3C` |
| `--text-primary` | `rgba(0,0,0,0.847)` | `rgba(255,255,255,0.847)` |
| `--text-secondary` | `rgba(0,0,0,0.498)` | `rgba(255,255,255,0.549)` |
| `--text-tertiary` | `rgba(0,0,0,0.247)` | `rgba(255,255,255,0.247)` |
| `--separator` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.1)` |
| `--accent` | From Electron API (default `#007AFF` / `#0A84FF`) |
| `--success` | `#34C759` | `#32D74B` |
| `--destructive` | `#FF3B30` | `#FF453A` |

### Spacing (8pt Grid)

| Token | Value |
|-------|-------|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-12` | 48px |

### Border Radius

| Element | Value |
|---------|-------|
| Card/Panel | 10px |
| Button | 6px |
| Input | 6px |
| Popover/Sheet | 12px |

### Global Resets

- `cursor: default` on all elements
- `user-select: none` on UI chrome, `user-select: text` on content
- Overlay scrollbars: `scrollbar-width: thin`, neutral gray thumb

---

## 2. Layout

### Overall Structure

- **Two-column**: fixed sidebar (220px left) + scrollable content (right)
- Sidebar always visible, no collapse behavior

### Sidebar

- **Background**: transparent (Electron vibrancy material shows through)
- **Drag region**: top 52px is `-webkit-app-region: drag`
- **Logo area**: App name "Money Monitor" in 13px semibold, ~60px top padding to clear traffic lights
- **Nav items**:
  - 28px row height, 12px left padding, icon (16px) + 8px gap + label (13px)
  - **Selected**: accent-color background fill, rounded 6px, white text
  - **Hover**: subtle `rgba(0,0,0,0.04)` / `rgba(255,255,255,0.06)`
  - **Inactive**: `--text-primary`, no background
- **Section headers**: UPPERCASE, 11px, semibold, `--text-secondary`
- **Separator**: 1px `--separator` between sections
- **Bottom**: Settings nav item pinned to bottom

### Toolbar / Header Area

- Height: 52px, top of content area, is a drag region
- Page title: 17px semibold, left-aligned
- Action buttons: right-aligned, `no-drag`
- Bottom: 1px `--separator`

### Content Area

- Background: `--bg-primary` (solid)
- Scrollable with overlay scrollbars
- Padding: 24px all sides
- Section gap: 24px

### Window Focus/Blur

- Blur: sidebar selected item turns gray, UI slightly desaturates
- Focus: restore normal accent colors

---

## 3. Components

### Buttons

| Variant | Style |
|---------|-------|
| Primary | Accent fill, white text, 6px radius |
| Secondary | `--bg-tertiary` fill, `--text-primary` text |
| Ghost | Transparent, hover: subtle bg tint |
| Destructive | `--destructive` fill, white text |
| Outline | 1px `--separator` border, transparent bg |

- Sizes: sm=22px, md=28px, lg=34px height
- `cursor: default`, no hover glow/shadow
- Pressed: slightly darker (brightness filter)
- Disabled: 50% opacity

### Inputs & Textareas

- Height: 28px (regular), 22px (small)
- Background: `--bg-primary`
- Border: 1px `--separator`, radius: 6px
- Focus: `box-shadow: 0 0 0 3px rgba(accent, 0.3)`
- Padding: 6px 8px, font: 13px system

### Cards / Panels

- Background: `--bg-primary`
- Border: 1px `--separator`, radius: 10px
- Padding: 16px
- No shadow, no hover effects

### Tables

- Header: `--text-secondary`, 11px uppercase semibold, bottom 1px separator
- Rows: 32px height, bottom 1px separator
- Hover: subtle bg tint
- Cell padding: 8px horizontal

### Badges

- Pill shape (`border-radius: 100px`), 20px height, 2px 8px padding, 11px font
- Default: `--bg-tertiary` bg, `--text-secondary` text
- Colored: macOS system color at 15% opacity bg + full color text

### Dialogs / Sheets

- Centered overlay, `rgba(0,0,0,0.4)` backdrop
- `--bg-primary` bg, 12px radius, 24px padding
- Shadow: `0 16px 48px rgba(0,0,0,0.2)`
- Title: 15px semibold, body: 13px

### Select / Dropdown

- Trigger: 28px height, 6px radius, separator border
- Dropdown: 12px radius, subtle shadow
- Items: 28px height, 6px radius hover highlight
- Selected: checkmark icon

### Switch / Toggle

- 36px x 22px pill, off: `--bg-tertiary`, on: accent color
- White thumb with subtle shadow

### Charts (Rounded macOS Style)

- **Line charts**: 2.5px stroke, tension: 0.4 (smooth curves), rounded lineCap/lineJoin
- **Bar charts**: borderRadius: 6px on bars
- **Doughnut charts**: cutout: 70%, borderRadius: 6px on segments
- **Area fills**: soft gradient from accent at 15% opacity to transparent
- **Grid lines**: dashed, `--separator` at 50% opacity
- **Axis labels**: `--text-secondary`, 11px system font
- **Tooltips**: macOS popover style (12px radius, subtle shadow)
- **Legend**: small circles (not squares), 11px labels
- **Colors**: macOS system palette — Blue #007AFF, Green #34C759, Orange #FF9500, Purple #AF52DE, Pink #FF2D55, Teal #5AC8FA, Yellow #FFCC00, Red #FF3B30 (with dark mode variants)
- **Animation**: easeOutCubic, 400ms

### Skeleton

- Background: `--bg-tertiary`, subtle opacity shimmer (0.3-0.7-0.3)

---

## 4. Screen Designs

### Overview Dashboard (`/`)

- Toolbar: "Overview" title
- KPI row: horizontal stat cards (account name 11px secondary, balance 22px semibold, provider badge)
- Credit card section: 3 stat cards (This Month, Last Month, Difference with colored delta)
- Charts: 2-column (Doughnut + Bar), full-width Cashflow bar
- Per-account spending: grid of compact stat cards

### Net Worth (`/net-worth`)

- Toolbar: "Net Worth" + "Add Asset" primary button
- Hero KPI: large total (26px semibold) centered card
- Charts: Doughnut by asset type + Line history (smooth, gradient fill)
- Asset sections: grouped by type, section headers (11px uppercase). Assets as clickable list rows (icon, name, value, chevron) — not floating cards
- Liabilities: same list pattern, red-tinted values

### Asset Detail (`/net-worth/assets/:id`)

- Toolbar: back button (ghost) + asset name + type badge
- KPI row: 3-column (Current Value, Contributed, Return)
- Chart: smooth line with gradient fill
- Detail: varies by type (table for holdings, list for contributions)

### Transactions (`/transactions`)

- Toolbar: "Transactions" + filter toggle (ghost)
- Filter bar: collapsible row of inputs/selects (28px, 6px radius, 8px gaps)
- Table: 11px uppercase headers, 32px rows, 1px separators, hover highlight. Colored amounts. Inline category editing. Right-click context menu.
- Pagination: "Page X of Y" + ghost prev/next buttons

### Insights (`/insights`)

- Toolbar: "Insights" + unread count badge
- Table: flagged transactions with confidence badges (red/yellow/green system colors)
- Actions: inline category select + checkmark confirm

### Accounts (`/accounts`)

- Toolbar: "Accounts" + "Add Account" primary button
- Section headers: "Banks" / "Credit Cards" (11px uppercase)
- Account list: bordered list rows (name, status badge, provider, balance, last scraped). Action buttons on hover (ghost icons).
- Dialogs: sheet-style for Add Account, OTP, Manual Login

### AI Chat (`/chat`)

- Toolbar: "Chat" + "New Chat" ghost button
- Split: session list (180px left) + chat area (right)
- Session list: simple rows (title + timestamp), accent-highlighted selection
- Messages: user in accent bubbles (6px radius), assistant in `--bg-secondary` bubbles. 24px circle avatars.
- Input: 28px input + send icon button at bottom
- Typing: 3 pulsing dots in `--text-tertiary`

### Categories (`/categories`)

- Toolbar: "Categories" + "Add Category" primary button
- Table: color dot, name, label, rules, ignored toggle
- Inline editing: click-to-edit
- Re-categorize: date range inputs + action button

### Scraping Dashboard (`/scraping`)

- Toolbar: "Scraping" + account select + "Scrape All" primary button
- Active session: progress banner with spinner, per-account status rows
- Session history: expandable list rows

### Settings (`/settings`)

- Toolbar: "Settings"
- Grouped sections (like macOS System Settings): "AI Configuration", "Security", "Scraping", "Telegram", "System"
- Form layout: label (11px secondary above) + input (28px) pairs, switches right-aligned
- Save: primary button at bottom with inline feedback

### Setup Wizard (`/setup`)

- Full-screen (no sidebar/toolbar), centered card on `--bg-secondary`
- App logo, 3-pill step indicator
- Each step: title (17px), description (13px), inputs
- Navigation: Back (ghost) + Next/Finish (primary)

---

## 5. Technical Notes

- Remove `class="dark"` from `dashboard/index.html`
- Remove Google Font imports (Geist, DM Sans) from `dashboard/index.html`
- Replace entire `style.css` design token system
- Update all 23+ UI components in `dashboard/src/components/ui/`
- Update all 11 views/pages
- Update `AppLayout.vue` (sidebar always visible, toolbar pattern)
- Update Electron main process (`main.ts` or equivalent) for vibrancy, accent color, focus/blur
- Update Electron version to >= 36.9.2 for macOS 26 Tahoe compatibility
- Chart.js configuration updates for rounded styles across all chart components
