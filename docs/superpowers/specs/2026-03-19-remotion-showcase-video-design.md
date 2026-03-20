# Money Monitor — Remotion Showcase Video Design

## Overview

A 75-second product showcase video for Money Monitor, built with Remotion. The video uses a cinematic "App Window Zoom" approach — a single continuous camera that pans and zooms across a stylized mockup of the full app, stopping at each feature zone.

**Target audience:** Potential users and the open-source community (GitHub README, social media).

## Video Specs

| Property   | Value                                              |
| ---------- | -------------------------------------------------- |
| Duration   | ~75 seconds                                        |
| Resolution | 1920×1080                                          |
| FPS        | 30                                                 |
| Codec      | H.264                                              |
| Tone       | Sleek & minimal (Apple keynote style)              |
| Audio      | Background music (user-provided royalty-free .mp3) |

## Narrative Structure

The video follows a clear 4-act structure separating **what** the app does from **how** it works.

### Act 1 — Intro (0–10s)

| Time  | Scene        | Description                                                                                                                                                                                                                               |
| ----- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–8s  | ① Title Card | Logo scales up from 0→1 with spring. "Money Monitor" fades in 10 frames later. Tagline "Self-hosted personal finance" fades in 10 frames after that. Camera at 1.5× zoom, centered. Title elements fade out during the reveal transition. |
| 8–10s | ↗ Reveal     | Camera pulls back (spring zoom to 0.5×) to reveal the full app mockup. Brief pause.                                                                                                                                                       |

### Act 2 — The What (10–52s)

Features shown front and center — what the user gets.

| Time   | Scene       | Animations                                                                                                                                                                                                                          | Label                                                    |
| ------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 10–25s | ② Dashboard | Doughnut chart arcs draw in sequentially (strokeDashoffset). Bar chart bars grow from bottom with staggered spring (50ms delay each). Stats cards count up from 0 to final value with easeOut.                                      | "Smart Dashboard — Your finances at a glance"            |
| 25–40s | ③ AI Chat   | User message slides in from right with spring scale. Typing indicator dots animate (0.5s), then AI response text streams in (1 char every 2 frames). Single exchange only — keep messages short (~40 chars each) to fit the window. | "AI Financial Advisor — Ask anything about your money"   |
| 40–52s | ④ Net Worth | SVG line chart path draws left-to-right (strokeDashoffset, 2s). Asset breakdown horizontal bars slide in from left, staggered (Stocks, Crypto, Real Estate, Cash). Total number counts up with easeOut.                             | "Net Worth Tracker — Stocks, crypto, real estate & more" |

### Act 3 — The How (52–67s)

The engine behind the features — how data gets in.

| Time   | Scene      | Animations                                                                                                                                                                 | Label                                                   |
| ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 52–58s | ⑤ Accounts | 3-4 stylized bank cards fan in from a stack (rotateZ + translateX, spring). "Connected" badges pop in with scale spring on each card.                                      | "Connect Your Banks — 18 institutions supported"        |
| 58–67s | ⑥ Scraping | Progress rows appear one by one (fade + translateY). Progress bar widths animate 0%→100% with easeInOut. Status dots flip orange→green with scale pulse as each completes. | "Auto Sync — Transactions scraped daily, automatically" |

### Act 4 — Close (67–75s)

| Time   | Scene             | Description                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 67–75s | ⑦ Pull back + CTA | Camera zooms out to full view (same 0.5× as the reveal, same center). App mockup blurs slightly (CSS filter: blur(4px)) to push focus to the overlay text. "Your finances. Your data. Your control." — each phrase fades in sequentially (1s apart). GitHub link fades in 1s after the last phrase with a width-expanding underline (0→100% over 15 frames). |

## Camera System

The canvas is a **3840×2160** React component containing styled mockups of all app zones. The **1920×1080** video acts as a viewport. A `Camera` component wraps the canvas and applies `transform: translate(-x, -y) scale(zoom)` (translate first, then scale — so coordinates are always in canvas-space). Values are interpolated between keyframes using Remotion `spring()`.

### Camera Keyframes

```typescript
type CameraKeyframe = {
  frame: number; // when to arrive
  x: number; // canvas X center (px)
  y: number; // canvas Y center (px)
  zoom: number; // 1 = 1:1, 2 = zoomed in 2×, 0.5 = zoomed out
  label?: string; // feature name
  tagline?: string; // feature description
};

const KEYFRAMES: CameraKeyframe[] = [
  { frame: 0, x: 1920, y: 1080, zoom: 1.5, label: undefined }, // ① Title — centered, zoomed in
  { frame: 240, x: 1920, y: 1080, zoom: 0.5 }, // ↗ Reveal — pull back to full view
  {
    frame: 300,
    x: 2800,
    y: 540,
    zoom: 1.2,
    label: 'Smart Dashboard',
    tagline: 'Your finances at a glance',
  }, // ② Dashboard
  {
    frame: 750,
    x: 1200,
    y: 1500,
    zoom: 1.3,
    label: 'AI Financial Advisor',
    tagline: 'Ask anything about your money',
  }, // ③ AI Chat
  {
    frame: 1200,
    x: 2900,
    y: 1200,
    zoom: 1.2,
    label: 'Net Worth Tracker',
    tagline: 'Stocks, crypto, real estate & more',
  }, // ④ Net Worth
  {
    frame: 1560,
    x: 2900,
    y: 700,
    zoom: 1.4,
    label: 'Connect Your Banks',
    tagline: '18 institutions supported',
  }, // ⑤ Accounts
  {
    frame: 1740,
    x: 2900,
    y: 1650,
    zoom: 1.3,
    label: 'Auto Sync',
    tagline: 'Transactions scraped daily, automatically',
  }, // ⑥ Scraping
  { frame: 2010, x: 1920, y: 1080, zoom: 0.5 }, // ⑦ Pull back + CTA
];
```

These coordinates are starting estimates based on the zone layout below. Fine-tune in Remotion Studio's preview.

### Camera Transitions

- **All transitions:** `spring({ damping: 200, stiffness: 100, mass: 0.8 })` — critically damped (no overshoot), smooth deceleration
- Camera interpolates between the current and next keyframe starting when the current keyframe's frame is reached

## Visual Style

### Colors (from app's HIG palette)

| Role           | Hex       |
| -------------- | --------- |
| Primary        | `#007AFF` |
| Text           | `#1D1D1F` |
| Background     | `#F5F5F7` |
| Success        | `#34C759` |
| Warning        | `#FF9500` |
| Accent         | `#FF3B30` |
| Purple         | `#AF52DE` |
| Secondary text | `#86868B` |

### Typography

- **Font:** Inter (via `@remotion/google-fonts`) — closest web equivalent to SF Pro
- **Title:** 700 weight, -0.5px letter-spacing
- **Tagline:** 500 weight
- **Body:** 400 weight

### Feature Labels

Each scene gets a floating label positioned at the bottom-left of the viewport (not the canvas).

- Format: **"Feature Name — Tagline"**
- Animation: fade in + translateY(10px → 0) with spring, 15 frames after camera arrives
- Fade out: 10 frames before camera leaves

## Canvas Layout

The 3840×2160 canvas positions scene zones absolutely. The Sidebar is a passive decoration — always present, never zoomed into.

| Zone      | CSS Position (top, left) | Size (w × h) | Notes                                                         |
| --------- | ------------------------ | ------------ | ------------------------------------------------------------- |
| Sidebar   | `top: 0, left: 0`        | 200 × 2160   | Full height, dark background                                  |
| Title     | `top: 780, left: 1560`   | 720 × 600    | Centered on canvas, fades out after reveal                    |
| Dashboard | `top: 60, left: 260`     | 3520 × 900   | Top area, right of sidebar                                    |
| AI Chat   | `top: 1020, left: 260`   | 1800 × 1080  | Bottom-left                                                   |
| Net Worth | `top: 1020, left: 2120`  | 1660 × 560   | Middle-right                                                  |
| Accounts  | `top: 1020, left: 2120`  | 1660 × 500   | Shares right column with scraping (shown when camera arrives) |
| Scraping  | `top: 1580, left: 2120`  | 1660 × 520   | Bottom-right                                                  |

These are starting estimates. Adjust in Remotion Studio to ensure the camera frames each zone with comfortable padding.

## Mockup Data

Hardcoded sample data used in the stylized UI mockups (not pulled from the real app).

### Dashboard

- **Doughnut chart categories:** Food (28%, #FF9500), Housing (35%, #007AFF), Transport (15%, #AF52DE), Shopping (12%, #FF3B30), Other (10%, #34C759)
- **Bar chart (monthly spending):** Oct ₪8.2k, Nov ₪9.1k, Dec ₪11.4k, Jan ₪7.8k, Feb ₪8.9k, Mar ₪6.3k
- **Stats cards:** Total Spent ₪12,450 · Avg/Day ₪415 · Transactions 127

### AI Chat

- **User message:** "How much did I spend on food this month?"
- **AI response:** "You spent ₪2,340 on food this month — 18% less than last month's ₪2,850."

### Net Worth

- **Line chart points (12 months):** ₪180k → ₪195k → ₪188k → ₪201k → ₪210k → ₪205k → ₪220k → ₪235k → ₪228k → ₪245k → ₪260k → ₪275k
- **Asset breakdown:** Stocks ₪120k (44%), Cash ₪85k (31%), Crypto ₪42k (15%), Real Estate ₪28k (10%)
- **Total:** ₪275,000

### Accounts

- Bank cards: Hapoalim, Leumi, Discount (+ Max credit card)

### Scraping

- Progress rows: Hapoalim (Done, 23 txns), Leumi Card (Scraping..., 67%), Visa Cal (Queued)

## Audio

Background music file should be placed at `public/music.mp3`. The video renders silently if the file is absent.

- **Volume:** 0.3 (subtle background)
- **Fade in:** first 30 frames (0→0.3)
- **Fade out:** last 60 frames (0.3→0)

## Technical Architecture

### Project Structure

```
video/
├── src/
│   ├── Root.tsx              — Composition registration
│   ├── Video.tsx             — Main composition (camera + canvas)
│   ├── Canvas.tsx            — 3840×2160 full app mockup
│   ├── Camera.tsx            — Viewport transform logic
│   ├── FeatureLabel.tsx      — "Feature — Tagline" overlay
│   ├── scenes/
│   │   ├── TitleCard.tsx     — Logo + name + tagline
│   │   ├── Dashboard.tsx     — Charts + stats
│   │   ├── AiChat.tsx        — Chat bubbles + typewriter
│   │   ├── NetWorth.tsx      — Line chart + asset bars
│   │   ├── Accounts.tsx      — Bank card fan
│   │   ├── Scraping.tsx      — Progress rows + status dots
│   │   └── ClosingCta.tsx    — Tagline + GitHub link
│   ├── components/
│   │   ├── Sidebar.tsx       — App sidebar mockup
│   │   ├── DoughnutChart.tsx — SVG animated doughnut
│   │   ├── BarChart.tsx      — Animated bar chart
│   │   ├── LineChart.tsx     — SVG path draw
│   │   ├── ChatBubble.tsx    — Message bubble + typewriter
│   │   ├── ProgressRow.tsx   — Scrape status row
│   │   └── CountUp.tsx       — Animated number counter
│   └── lib/
│       ├── theme.ts          — Colors, fonts, spacing
│       └── camera-keyframes.ts — Camera position/zoom per frame
├── public/
│   └── logo.svg
├── package.json
└── tsconfig.json
```

### Key Technical Decisions

- **Standalone project:** `video/` has its own package.json and tsconfig, not integrated into the monorepo workspace. Keeps video tooling isolated from the app's build pipeline.
- **Pure SVG charts:** No Chart.js or canvas-based libraries. Remotion needs DOM elements for frame-perfect rendering. Charts built with SVG paths animated via `strokeDashoffset`.
- **Inter font:** Loaded via `@remotion/google-fonts` at composition level.
- **Audio:** User-provided royalty-free .mp3 via Remotion `<Audio>` component with volume fade-in (first 30 frames) and fade-out (last 60 frames).
- **Rendering:** `npx remotion render` with default H.264 codec.

### Component Hierarchy

```
Video.tsx (1920×1080 viewport)
├── Camera.tsx (transform: translate + scale)
│   └── Canvas.tsx (3840×2160)
│       ├── Sidebar.tsx
│       ├── TitleCard.tsx
│       ├── Dashboard.tsx → DoughnutChart, BarChart, CountUp
│       ├── AiChat.tsx → ChatBubble
│       ├── NetWorth.tsx → LineChart, CountUp
│       ├── Accounts.tsx
│       ├── Scraping.tsx → ProgressRow
│       └── ClosingCta.tsx
├── FeatureLabel.tsx (fixed to viewport)
└── <Audio> (background track)
```

## Commands

```bash
# Preview in browser
cd video && npx remotion studio

# Render to file
cd video && npx remotion render src/Root.tsx MoneyMonitorShowcase out/showcase.mp4
```

The composition ID `MoneyMonitorShowcase` is registered in `Root.tsx` via `<Composition id="MoneyMonitorShowcase" ...>`.
