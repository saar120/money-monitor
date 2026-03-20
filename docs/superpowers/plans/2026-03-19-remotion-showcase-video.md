# Remotion Showcase Video Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 75-second cinematic product showcase video for Money Monitor using Remotion, with a continuous camera fly-through across a stylized app mockup.

**Architecture:** A standalone `video/` Remotion project (React + TypeScript). A 3840×2160 `Canvas` contains all scene zones positioned absolutely. A `Camera` component applies `transform: translate() scale()` to pan/zoom across the canvas. `FeatureLabel` overlays are fixed to the 1920×1080 viewport. All animations driven by `useCurrentFrame()` — no CSS transitions.

**Tech Stack:** Remotion 4, React 19, TypeScript, `@remotion/google-fonts` (Inter), `@remotion/paths` (line chart), SVG for charts. Audio via core `remotion` `<Audio>` component.

**Spec:** `docs/superpowers/specs/2026-03-19-remotion-showcase-video-design.md`

---

## Chunk 1: Project Scaffolding & Core Infrastructure

### Task 1: Scaffold the Remotion project

**Files:**

- Create: `video/package.json`
- Create: `video/tsconfig.json`
- Create: `video/src/Root.tsx`
- Create: `video/src/Video.tsx`
- Create: `video/src/lib/theme.ts`

- [ ] **Step 1: Initialize Remotion project**

```bash
cd /Users/saaramrani/projects/money-monitor
npx create-video@latest video --template blank
```

If the CLI prompts for package manager, select npm. This creates the `video/` directory with all Remotion boilerplate.

- [ ] **Step 2: Install additional dependencies**

```bash
cd /Users/saaramrani/projects/money-monitor/video
npx remotion add @remotion/google-fonts
npx remotion add @remotion/paths
```

- [ ] **Step 3: Create theme file**

Create `video/src/lib/theme.ts`:

```typescript
export const COLORS = {
  primary: '#007AFF',
  text: '#1D1D1F',
  background: '#F5F5F7',
  success: '#34C759',
  warning: '#FF9500',
  accent: '#FF3B30',
  purple: '#AF52DE',
  secondaryText: '#86868B',
  sidebarBg: '#1D1D1F',
  white: '#FFFFFF',
  cardShadow: 'rgba(0, 0, 0, 0.08)',
} as const;

export const CANVAS = {
  width: 3840,
  height: 2160,
} as const;

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 2250, // 75s × 30fps
} as const;
```

- [ ] **Step 4: Verify the project runs**

```bash
cd /Users/saaramrani/projects/money-monitor/video
npx remotion studio
```

Expected: Browser opens at localhost:3000 with Remotion Studio showing the default composition.

- [ ] **Step 5: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/
git commit -m "feat(video): scaffold Remotion project with dependencies"
```

---

### Task 2: Camera system & keyframes

**Files:**

- Create: `video/src/lib/camera-keyframes.ts`
- Create: `video/src/Camera.tsx`

- [ ] **Step 1: Create camera keyframes**

Create `video/src/lib/camera-keyframes.ts`:

```typescript
export type CameraKeyframe = {
  frame: number;
  x: number;
  y: number;
  zoom: number;
  label?: string;
  tagline?: string;
};

export const KEYFRAMES: CameraKeyframe[] = [
  { frame: 0, x: 1920, y: 1080, zoom: 1.5 },
  { frame: 240, x: 1920, y: 1080, zoom: 0.5 },
  {
    frame: 300,
    x: 2800,
    y: 540,
    zoom: 1.2,
    label: 'Smart Dashboard',
    tagline: 'Your finances at a glance',
  },
  {
    frame: 750,
    x: 1200,
    y: 1500,
    zoom: 1.3,
    label: 'AI Financial Advisor',
    tagline: 'Ask anything about your money',
  },
  {
    frame: 1200,
    x: 2900,
    y: 1200,
    zoom: 1.2,
    label: 'Net Worth Tracker',
    tagline: 'Stocks, crypto, real estate & more',
  },
  {
    frame: 1560,
    x: 2900,
    y: 700,
    zoom: 1.4,
    label: 'Connect Your Banks',
    tagline: '18 institutions supported',
  },
  {
    frame: 1740,
    x: 2900,
    y: 1650,
    zoom: 1.3,
    label: 'Auto Sync',
    tagline: 'Transactions scraped daily, automatically',
  },
  { frame: 2010, x: 1920, y: 1080, zoom: 0.5 },
];
```

- [ ] **Step 2: Create Camera component**

Create `video/src/Camera.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { KEYFRAMES } from './lib/camera-keyframes';
import { CANVAS } from './lib/theme';

const SPRING_CONFIG = { damping: 200, stiffness: 100, mass: 0.8 };

export const Camera: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Find current and next keyframe
  let currentIdx = 0;
  for (let i = KEYFRAMES.length - 1; i >= 0; i--) {
    if (frame >= KEYFRAMES[i].frame) {
      currentIdx = i;
      break;
    }
  }
  const nextIdx = Math.min(currentIdx + 1, KEYFRAMES.length - 1);
  const current = KEYFRAMES[currentIdx];
  const next = KEYFRAMES[nextIdx];

  // Interpolate between keyframes using spring
  const progress =
    currentIdx === nextIdx
      ? 1
      : spring({
          frame: frame - current.frame,
          fps,
          config: SPRING_CONFIG,
          durationInFrames: next.frame - current.frame,
        });

  const x = interpolate(progress, [0, 1], [current.x, next.x]);
  const y = interpolate(progress, [0, 1], [current.y, next.y]);
  const zoom = interpolate(progress, [0, 1], [current.zoom, next.zoom]);

  // Center the viewport on (x, y) at the given zoom
  const translateX = -(x * zoom) + 1920 / 2;
  const translateY = -(y * zoom) + 1080 / 2;

  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: CANVAS.width,
          height: CANVAS.height,
          transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
        }}
      >
        {children}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/Camera.tsx video/src/lib/camera-keyframes.ts
git commit -m "feat(video): add camera system with keyframe interpolation"
```

---

### Task 3: FeatureLabel overlay

**Files:**

- Create: `video/src/FeatureLabel.tsx`

- [ ] **Step 1: Create FeatureLabel component**

Create `video/src/FeatureLabel.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { KEYFRAMES } from './lib/camera-keyframes';
import { COLORS } from './lib/theme';
import { loadFont } from '@remotion/google-fonts/Inter';

const { fontFamily } = loadFont('normal', {
  weights: ['500', '700'],
  subsets: ['latin'],
});

export const FeatureLabel: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Find current keyframe
  let currentIdx = 0;
  for (let i = KEYFRAMES.length - 1; i >= 0; i--) {
    if (frame >= KEYFRAMES[i].frame) {
      currentIdx = i;
      break;
    }
  }
  const current = KEYFRAMES[currentIdx];
  const nextFrame = currentIdx < KEYFRAMES.length - 1 ? KEYFRAMES[currentIdx + 1].frame : Infinity;

  if (!current.label) return null;

  // Fade in 15 frames after camera arrives
  const fadeInStart = current.frame + 15;
  const fadeInProgress = spring({
    frame: frame - fadeInStart,
    fps,
    config: { damping: 200 },
  });

  // Fade out 10 frames before camera leaves
  const fadeOutStart = nextFrame - 10;
  const fadeOut =
    frame >= fadeOutStart
      ? interpolate(frame, [fadeOutStart, nextFrame], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;

  const opacity = Math.min(fadeInProgress, fadeOut);
  const translateY = interpolate(fadeInProgress, [0, 1], [10, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 60,
        left: 60,
        transform: `translateY(${translateY}px)`,
        opacity,
        fontFamily,
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 36, fontWeight: 700, color: COLORS.text, letterSpacing: -0.5 }}>
        {current.label}
      </span>
      {current.tagline && (
        <>
          <span style={{ fontSize: 22, color: COLORS.secondaryText }}>—</span>
          <span style={{ fontSize: 22, fontWeight: 500, color: COLORS.secondaryText }}>
            {current.tagline}
          </span>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/FeatureLabel.tsx
git commit -m "feat(video): add FeatureLabel overlay component"
```

---

### Task 4: Canvas shell, Video composition & Root

**Files:**

- Create: `video/src/Canvas.tsx`
- Modify: `video/src/Video.tsx`
- Modify: `video/src/Root.tsx`

- [ ] **Step 1: Create Canvas shell**

Create `video/src/Canvas.tsx` — for now, just the container with a background and empty zone placeholders:

```tsx
import React from 'react';
import { CANVAS, COLORS } from './lib/theme';

export const Canvas: React.FC = () => {
  return (
    <div
      style={{
        width: CANVAS.width,
        height: CANVAS.height,
        background: COLORS.background,
        position: 'relative',
      }}
    >
      {/* Sidebar placeholder */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 200,
          height: CANVAS.height,
          background: COLORS.sidebarBg,
          borderRadius: '16px 0 0 16px',
        }}
      />
      {/* Scene zones will be added in subsequent tasks */}
    </div>
  );
};
```

- [ ] **Step 2: Create Video composition**

Replace `video/src/Video.tsx` with:

```tsx
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Camera } from './Camera';
import { Canvas } from './Canvas';
import { FeatureLabel } from './FeatureLabel';
import { COLORS } from './lib/theme';

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.text }}>
      <Camera>
        <Canvas />
      </Camera>
      <FeatureLabel />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 3: Update Root.tsx**

Replace `video/src/Root.tsx` with:

```tsx
import { Composition } from 'remotion';
import { Video } from './Video';
import { VIDEO } from './lib/theme';

export const RemotionRoot = () => {
  return (
    <Composition
      id="MoneyMonitorShowcase"
      component={Video}
      durationInFrames={VIDEO.durationInFrames}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
};
```

- [ ] **Step 4: Verify in Remotion Studio**

```bash
cd /Users/saaramrani/projects/money-monitor/video
npx remotion studio
```

Expected: The composition "MoneyMonitorShowcase" appears. Scrubbing through the timeline shows the camera panning across the gray canvas with the dark sidebar. Feature labels appear and disappear at the correct times.

- [ ] **Step 5: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/Canvas.tsx video/src/Video.tsx video/src/Root.tsx
git commit -m "feat(video): wire up Video composition with Camera, Canvas, and FeatureLabel"
```

---

## Chunk 2: Reusable Components

### Task 5: CountUp component

**Files:**

- Create: `video/src/components/CountUp.tsx`

- [ ] **Step 1: Create CountUp**

Create `video/src/components/CountUp.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

type CountUpProps = {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  durationInFrames?: number;
  delay?: number;
  style?: React.CSSProperties;
};

export const CountUp: React.FC<CountUpProps> = ({
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
  durationInFrames = 60,
  delay = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const delayedFrame = frame - delay;

  const progress = interpolate(delayedFrame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });

  const current = progress * value;
  const formatted = current.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span style={style}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/components/CountUp.tsx
git commit -m "feat(video): add CountUp animated number component"
```

---

### Task 6: DoughnutChart component

**Files:**

- Create: `video/src/components/DoughnutChart.tsx`

- [ ] **Step 1: Create DoughnutChart**

Create `video/src/components/DoughnutChart.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';

type Segment = {
  value: number;
  color: string;
  label: string;
};

type DoughnutChartProps = {
  segments: Segment[];
  size?: number;
  strokeWidth?: number;
  delay?: number;
};

export const DoughnutChart: React.FC<DoughnutChartProps> = ({
  segments,
  size = 300,
  strokeWidth = 40,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  let cumulativeOffset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((segment, i) => {
        const segmentLength = (segment.value / total) * circumference;
        const segmentDelay = delay + i * 8;

        const progress = spring({
          frame: frame - segmentDelay,
          fps,
          config: { damping: 200 },
        });

        const dashOffset = segmentLength * (1 - progress);
        const rotation = (cumulativeOffset / circumference) * 360 - 90;
        cumulativeOffset += segmentLength;

        return (
          <circle
            key={segment.label}
            r={radius}
            cx={center}
            cy={center}
            fill="none"
            stroke={segment.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${segmentLength} ${circumference}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(${rotation} ${center} ${center})`}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/components/DoughnutChart.tsx
git commit -m "feat(video): add DoughnutChart SVG component"
```

---

### Task 7: BarChart component

**Files:**

- Create: `video/src/components/BarChart.tsx`

- [ ] **Step 1: Create BarChart**

Create `video/src/components/BarChart.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { COLORS } from '../lib/theme';

type BarData = {
  label: string;
  value: number;
};

type BarChartProps = {
  bars: BarData[];
  width?: number;
  height?: number;
  delay?: number;
};

export const BarChart: React.FC<BarChartProps> = ({
  bars,
  width = 500,
  height = 250,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const maxValue = Math.max(...bars.map((b) => b.value));
  const barGap = 8;
  const labelHeight = 30;
  const barWidth = (width - (bars.length - 1) * barGap) / bars.length;
  const chartHeight = height - labelHeight;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {bars.map((bar, i) => {
        // 50ms delay each = ~1.5 frames at 30fps, round to 2
        const barDelay = delay + i * 2;
        const progress = spring({
          frame: frame - barDelay,
          fps,
          config: { damping: 200 },
        });

        const maxBarHeight = (bar.value / maxValue) * chartHeight;
        const barHeight = maxBarHeight * progress;
        const x = i * (barWidth + barGap);
        const y = chartHeight - barHeight;

        return (
          <g key={bar.label}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={6} fill={COLORS.primary} />
            <text
              x={x + barWidth / 2}
              y={height - 6}
              textAnchor="middle"
              fill={COLORS.secondaryText}
              fontSize={14}
            >
              {bar.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/components/BarChart.tsx
git commit -m "feat(video): add BarChart animated component"
```

---

### Task 8: LineChart component

**Files:**

- Create: `video/src/components/LineChart.tsx`

- [ ] **Step 1: Create LineChart**

Create `video/src/components/LineChart.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { evolvePath } from '@remotion/paths';

type LineChartProps = {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  delay?: number;
  durationInFrames?: number;
};

export const LineChart: React.FC<LineChartProps> = ({
  points,
  width = 600,
  height = 200,
  color = '#34C759',
  strokeWidth = 4,
  delay = 0,
  durationInFrames = 60,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const minVal = Math.min(...points);
  const maxVal = Math.max(...points);
  const padding = 20;

  const pathData = points
    .map((val, i) => {
      const x = padding + (i / (points.length - 1)) * (width - 2 * padding);
      const y = padding + (1 - (val - minVal) / (maxVal - minVal)) * (height - 2 * padding);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const progress = interpolate(frame - delay, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });

  const { strokeDasharray, strokeDashoffset } = evolvePath(progress, pathData);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/components/LineChart.tsx
git commit -m "feat(video): add LineChart SVG path animation component"
```

---

### Task 9: ChatBubble component

**Files:**

- Create: `video/src/components/ChatBubble.tsx`

- [ ] **Step 1: Create ChatBubble**

Create `video/src/components/ChatBubble.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { COLORS } from '../lib/theme';

type ChatBubbleProps = {
  text: string;
  isUser: boolean;
  delay?: number;
  typewriter?: boolean;
  charFrames?: number;
};

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  text,
  isUser,
  delay = 0,
  typewriter = false,
  charFrames = 2,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delayedFrame = frame - delay;

  // Entrance animation
  const entrance = spring({
    frame: delayedFrame,
    fps,
    config: { damping: 200 },
  });

  // Typewriter for AI responses
  const displayText = typewriter
    ? text.slice(0, Math.max(0, Math.floor(Math.max(0, delayedFrame - 15) / charFrames)))
    : text;

  const translateX = interpolate(entrance, [0, 1], [isUser ? 40 : -40, 0]);

  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '75%',
        opacity: entrance,
        transform: `translateX(${translateX}px)`,
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderRadius: 20,
          backgroundColor: isUser ? COLORS.background : COLORS.primary,
          color: isUser ? COLORS.text : COLORS.white,
          fontSize: 22,
          lineHeight: 1.4,
        }}
      >
        {displayText}
        {typewriter && delayedFrame > 0 && displayText.length < text.length && (
          <span style={{ opacity: frame % 16 < 8 ? 1 : 0 }}>▎</span>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/components/ChatBubble.tsx
git commit -m "feat(video): add ChatBubble with typewriter effect"
```

---

### Task 10: ProgressRow component

**Files:**

- Create: `video/src/components/ProgressRow.tsx`

- [ ] **Step 1: Create ProgressRow**

Create `video/src/components/ProgressRow.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';
import { COLORS } from '../lib/theme';

type ProgressRowProps = {
  name: string;
  status: 'done' | 'scraping' | 'queued';
  detail: string;
  delay?: number;
};

export const ProgressRow: React.FC<ProgressRowProps> = ({ name, status, detail, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delayedFrame = frame - delay;

  const entrance = spring({
    frame: delayedFrame,
    fps,
    config: { damping: 200 },
  });

  const translateY = interpolate(entrance, [0, 1], [20, 0]);

  const dotColor =
    status === 'done'
      ? COLORS.success
      : status === 'scraping'
        ? COLORS.warning
        : COLORS.secondaryText;

  // For "done" status, animate dot from orange to green
  const dotScale =
    status === 'done'
      ? spring({
          frame: delayedFrame - 30,
          fps,
          config: { damping: 12, stiffness: 200 },
        })
      : 1;

  // Progress bar for "scraping" status
  const progressWidth =
    status === 'scraping'
      ? interpolate(delayedFrame, [0, 90], [0, 67], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.inOut(Easing.quad),
        })
      : status === 'done'
        ? 100
        : 0;

  return (
    <div
      style={{
        opacity: entrance,
        transform: `translateY(${translateY}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          backgroundColor: dotColor,
          transform: `scale(${dotScale})`,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 500, color: COLORS.text }}>{name}</span>
          <span style={{ fontSize: 14, color: COLORS.secondaryText }}>{detail}</span>
        </div>
        {status !== 'queued' && (
          <div style={{ height: 4, backgroundColor: COLORS.background, borderRadius: 2 }}>
            <div
              style={{
                height: '100%',
                width: `${progressWidth}%`,
                backgroundColor: status === 'done' ? COLORS.success : COLORS.warning,
                borderRadius: 2,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/components/ProgressRow.tsx
git commit -m "feat(video): add ProgressRow component for scraping scene"
```

---

### Task 11: Sidebar component

**Files:**

- Create: `video/src/components/Sidebar.tsx`

- [ ] **Step 1: Create Sidebar**

Create `video/src/components/Sidebar.tsx`:

```tsx
import React from 'react';
import { COLORS, CANVAS } from '../lib/theme';

const NAV_ITEMS = [
  { icon: '📊', active: true },
  { icon: '💰', active: false },
  { icon: '📋', active: false },
  null, // separator
  { icon: '💬', active: false },
  { icon: '💡', active: false },
  null, // separator
  { icon: '🏦', active: false },
  { icon: '🏷️', active: false },
  { icon: '🔔', active: false },
  { icon: '🔄', active: false },
  { icon: '⚙️', active: false },
];

export const Sidebar: React.FC = () => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 200,
        height: CANVAS.height,
        backgroundColor: COLORS.sidebarBg,
        borderRadius: '16px 0 0 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 50,
        gap: 8,
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: 64,
          height: 64,
          backgroundColor: COLORS.primary,
          borderRadius: 16,
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 32,
        }}
      >
        💵
      </div>
      {NAV_ITEMS.map((item, i) =>
        item === null ? (
          <div
            key={`sep-${i}`}
            style={{
              width: 60,
              height: 1,
              backgroundColor: '#48484A',
              margin: '8px 0',
            }}
          />
        ) : (
          <div
            key={i}
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              backgroundColor: item.active ? COLORS.primary + '30' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
            }}
          >
            {item.icon}
          </div>
        ),
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/components/Sidebar.tsx
git commit -m "feat(video): add Sidebar decorative component"
```

---

## Chunk 3: Scene Components

### Task 12: TitleCard scene

**Files:**

- Create: `video/src/scenes/TitleCard.tsx`

- [ ] **Step 1: Create TitleCard**

Create `video/src/scenes/TitleCard.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import { COLORS } from '../lib/theme';

const { fontFamily } = loadFont('normal', {
  weights: ['500', '700'],
  subsets: ['latin'],
});

export const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 200 } });
  const titleOpacity = interpolate(frame, [10, 25], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const taglineOpacity = interpolate(frame, [20, 35], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Fade out during reveal (starts at frame 240)
  const fadeOut = interpolate(frame, [220, 260], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: 780,
        left: 1560,
        width: 720,
        height: 600,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily,
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          backgroundColor: COLORS.primary,
          borderRadius: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 60,
          transform: `scale(${logoScale})`,
          marginBottom: 30,
        }}
      >
        💵
      </div>
      <div
        style={{
          fontSize: 64,
          fontWeight: 700,
          color: COLORS.text,
          letterSpacing: -1,
          opacity: titleOpacity,
        }}
      >
        Money Monitor
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 500,
          color: COLORS.secondaryText,
          marginTop: 12,
          opacity: taglineOpacity,
        }}
      >
        Self-hosted personal finance
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/scenes/TitleCard.tsx
git commit -m "feat(video): add TitleCard scene"
```

---

### Task 13: Dashboard scene

**Files:**

- Create: `video/src/scenes/Dashboard.tsx`

- [ ] **Step 1: Create Dashboard**

Create `video/src/scenes/Dashboard.tsx`. This scene uses DoughnutChart, BarChart, and CountUp. Its local frame starts at 0 when the camera arrives (frame 300 globally), so wrap it in a `<Sequence>` in Canvas.tsx later. For now, animate based on local frame:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import { DoughnutChart } from '../components/DoughnutChart';
import { BarChart } from '../components/BarChart';
import { CountUp } from '../components/CountUp';
import { COLORS } from '../lib/theme';

const { fontFamily } = loadFont('normal', {
  weights: ['400', '500', '700'],
  subsets: ['latin'],
});

const DOUGHNUT_DATA = [
  { value: 35, color: COLORS.primary, label: 'Housing' },
  { value: 28, color: COLORS.warning, label: 'Food' },
  { value: 15, color: COLORS.purple, label: 'Transport' },
  { value: 12, color: COLORS.accent, label: 'Shopping' },
  { value: 10, color: COLORS.success, label: 'Other' },
];

const BAR_DATA = [
  { label: 'Oct', value: 8200 },
  { label: 'Nov', value: 9100 },
  { label: 'Dec', value: 11400 },
  { label: 'Jan', value: 7800 },
  { label: 'Feb', value: 8900 },
  { label: 'Mar', value: 6300 },
];

const STATS = [
  { label: 'Total Spent', value: 12450, prefix: '₪' },
  { label: 'Avg/Day', value: 415, prefix: '₪' },
  { label: 'Transactions', value: 127, prefix: '' },
];

export const Dashboard: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: 260,
        width: 3520,
        height: 900,
        backgroundColor: COLORS.white,
        borderRadius: 20,
        boxShadow: `0 2px 8px ${COLORS.cardShadow}`,
        padding: 40,
        fontFamily,
        display: 'flex',
        gap: 40,
      }}
    >
      {/* Doughnut + Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.text }}>
          Spending by Category
        </div>
        <DoughnutChart segments={DOUGHNUT_DATA} size={400} strokeWidth={50} delay={15} />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
          {DOUGHNUT_DATA.map((seg) => (
            <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: seg.color }} />
              <span style={{ fontSize: 16, color: COLORS.secondaryText }}>
                {seg.label} {seg.value}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bar chart */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.text }}>Monthly Spending</div>
        <BarChart bars={BAR_DATA} width={1200} height={400} delay={25} />
      </div>

      {/* Stats cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 400 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.text }}>This Month</div>
        {STATS.map((stat, i) => (
          <div
            key={stat.label}
            style={{
              backgroundColor: COLORS.background,
              borderRadius: 16,
              padding: '24px 28px',
            }}
          >
            <div style={{ fontSize: 16, color: COLORS.secondaryText, marginBottom: 4 }}>
              {stat.label}
            </div>
            <CountUp
              value={stat.value}
              prefix={stat.prefix}
              delay={35 + i * 10}
              durationInFrames={45}
              style={{ fontSize: 40, fontWeight: 700, color: COLORS.text }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/scenes/Dashboard.tsx
git commit -m "feat(video): add Dashboard scene with charts and stats"
```

---

### Task 14: AiChat scene

**Files:**

- Create: `video/src/scenes/AiChat.tsx`

- [ ] **Step 1: Create AiChat**

Create `video/src/scenes/AiChat.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import { ChatBubble } from '../components/ChatBubble';
import { COLORS } from '../lib/theme';

const { fontFamily } = loadFont('normal', {
  weights: ['400', '500', '700'],
  subsets: ['latin'],
});

const USER_MSG = 'How much did I spend on food this month?';
const AI_MSG = "You spent ₪2,340 on food this month — 18% less than last month's ₪2,850.";

export const AiChat: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: 'absolute',
        top: 1020,
        left: 260,
        width: 1800,
        height: 1080,
        backgroundColor: COLORS.white,
        borderRadius: 20,
        boxShadow: `0 2px 8px ${COLORS.cardShadow}`,
        padding: 40,
        fontFamily,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 30 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: COLORS.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
          }}
        >
          💬
        </div>
        <span style={{ fontSize: 24, fontWeight: 700, color: COLORS.text }}>
          AI Financial Advisor
        </span>
      </div>

      {/* Chat area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          justifyContent: 'center',
        }}
      >
        <ChatBubble text={USER_MSG} isUser delay={15} />
        <ChatBubble text={AI_MSG} isUser={false} delay={45} typewriter charFrames={2} />
      </div>

      {/* Suggestion chips */}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        {['Compare to last month', 'Show breakdown', 'Set a budget'].map((chip) => (
          <div
            key={chip}
            style={{
              padding: '10px 18px',
              borderRadius: 20,
              backgroundColor: COLORS.background,
              fontSize: 16,
              color: COLORS.secondaryText,
            }}
          >
            {chip}
          </div>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/scenes/AiChat.tsx
git commit -m "feat(video): add AiChat scene with typewriter effect"
```

---

### Task 15: NetWorth scene

**Files:**

- Create: `video/src/scenes/NetWorth.tsx`

- [ ] **Step 1: Create NetWorth**

Create `video/src/scenes/NetWorth.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import { LineChart } from '../components/LineChart';
import { CountUp } from '../components/CountUp';
import { COLORS } from '../lib/theme';

const { fontFamily } = loadFont('normal', {
  weights: ['400', '500', '700'],
  subsets: ['latin'],
});

const CHART_POINTS = [180, 195, 188, 201, 210, 205, 220, 235, 228, 245, 260, 275];

const ASSETS = [
  { label: 'Stocks', value: 120, pct: 44, color: COLORS.primary },
  { label: 'Cash', value: 85, pct: 31, color: COLORS.success },
  { label: 'Crypto', value: 42, pct: 15, color: COLORS.warning },
  { label: 'Real Estate', value: 28, pct: 10, color: COLORS.purple },
];

export const NetWorth: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        position: 'absolute',
        top: 1020,
        left: 2120,
        width: 1660,
        height: 560,
        backgroundColor: COLORS.white,
        borderRadius: 20,
        boxShadow: `0 2px 8px ${COLORS.cardShadow}`,
        padding: 36,
        fontFamily,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 20,
        }}
      >
        <span style={{ fontSize: 24, fontWeight: 700, color: COLORS.text }}>Net Worth</span>
        <CountUp
          value={275000}
          prefix="₪"
          delay={20}
          durationInFrames={60}
          style={{ fontSize: 36, fontWeight: 700, color: COLORS.success }}
        />
      </div>

      <LineChart
        points={CHART_POINTS}
        width={1580}
        height={200}
        color={COLORS.success}
        strokeWidth={5}
        delay={10}
        durationInFrames={60}
      />

      {/* Asset breakdown bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
        {ASSETS.map((asset, i) => {
          const barProgress = spring({
            frame: frame - (40 + i * 10),
            fps,
            config: { damping: 200 },
          });

          return (
            <div key={asset.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  fontSize: 16,
                  color: COLORS.secondaryText,
                  width: 100,
                  textAlign: 'right',
                }}
              >
                {asset.label}
              </span>
              <div
                style={{ flex: 1, height: 20, backgroundColor: COLORS.background, borderRadius: 4 }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${asset.pct * barProgress}%`,
                    backgroundColor: asset.color,
                    borderRadius: 4,
                  }}
                />
              </div>
              <span style={{ fontSize: 14, color: COLORS.secondaryText, width: 50 }}>
                {asset.pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/scenes/NetWorth.tsx
git commit -m "feat(video): add NetWorth scene with line chart and asset bars"
```

---

### Task 16: Accounts scene

**Files:**

- Create: `video/src/scenes/Accounts.tsx`

- [ ] **Step 1: Create Accounts**

Create `video/src/scenes/Accounts.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import { COLORS } from '../lib/theme';

const { fontFamily } = loadFont('normal', {
  weights: ['400', '500', '700'],
  subsets: ['latin'],
});

const BANKS = [
  { name: 'Bank Hapoalim', icon: '🏦', color: '#E31E24' },
  { name: 'Bank Leumi', icon: '🏦', color: '#003DA5' },
  { name: 'Bank Discount', icon: '🏦', color: '#FF6600' },
  { name: 'Max (Credit)', icon: '💳', color: '#1E90FF' },
];

export const Accounts: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        position: 'absolute',
        top: 1020,
        left: 2120,
        width: 1660,
        height: 500,
        backgroundColor: COLORS.white,
        borderRadius: 20,
        boxShadow: `0 2px 8px ${COLORS.cardShadow}`,
        padding: 36,
        fontFamily,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      <span style={{ fontSize: 24, fontWeight: 700, color: COLORS.text }}>Connected Accounts</span>

      <div
        style={{
          display: 'flex',
          gap: 20,
          justifyContent: 'center',
          flex: 1,
          alignItems: 'center',
        }}
      >
        {BANKS.map((bank, i) => {
          const fanProgress = spring({
            frame: frame - (15 + i * 8),
            fps,
            config: { damping: 15, stiffness: 120 },
          });

          const rotation = interpolate(fanProgress, [0, 1], [15 - i * 10, 0]);
          const translateX = interpolate(fanProgress, [0, 1], [-100 + i * 30, 0]);

          const badgeProgress = spring({
            frame: frame - (40 + i * 8),
            fps,
            config: { damping: 200 },
          });

          return (
            <div
              key={bank.name}
              style={{
                width: 320,
                height: 200,
                borderRadius: 16,
                backgroundColor: bank.color,
                padding: 24,
                color: COLORS.white,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transform: `rotate(${rotation}deg) translateX(${translateX}px)`,
                opacity: fanProgress,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ fontSize: 32 }}>{bank.icon}</span>
                <div
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.25)',
                    borderRadius: 8,
                    padding: '4px 10px',
                    fontSize: 13,
                    fontWeight: 600,
                    transform: `scale(${badgeProgress})`,
                  }}
                >
                  Connected ✓
                </div>
              </div>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{bank.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/scenes/Accounts.tsx
git commit -m "feat(video): add Accounts scene with card fan animation"
```

---

### Task 17: Scraping scene

**Files:**

- Create: `video/src/scenes/Scraping.tsx`

- [ ] **Step 1: Create Scraping**

Create `video/src/scenes/Scraping.tsx`:

```tsx
import React from 'react';
import { loadFont } from '@remotion/google-fonts/Inter';
import { ProgressRow } from '../components/ProgressRow';
import { COLORS } from '../lib/theme';

const { fontFamily } = loadFont('normal', {
  weights: ['400', '500', '700'],
  subsets: ['latin'],
});

const ROWS = [
  { name: 'Bank Hapoalim', status: 'done' as const, detail: '23 transactions' },
  { name: 'Leumi Card', status: 'scraping' as const, detail: '67%' },
  { name: 'Visa Cal', status: 'queued' as const, detail: 'Queued' },
];

export const Scraping: React.FC = () => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 1580,
        left: 2120,
        width: 1660,
        height: 520,
        backgroundColor: COLORS.white,
        borderRadius: 20,
        boxShadow: `0 2px 8px ${COLORS.cardShadow}`,
        padding: 36,
        fontFamily,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: COLORS.purple + '20',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
          }}
        >
          🔄
        </div>
        <span style={{ fontSize: 24, fontWeight: 700, color: COLORS.text }}>Scraping Status</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {ROWS.map((row, i) => (
          <ProgressRow
            key={row.name}
            name={row.name}
            status={row.status}
            detail={row.detail}
            delay={15 + i * 20}
          />
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/scenes/Scraping.tsx
git commit -m "feat(video): add Scraping scene with progress rows"
```

---

### Task 18: ClosingCta scene

**Files:**

- Create: `video/src/scenes/ClosingCta.tsx`

- [ ] **Step 1: Create ClosingCta**

Create `video/src/scenes/ClosingCta.tsx`. This component is an overlay on the viewport (not positioned on the canvas), so it uses `AbsoluteFill`. It will be wrapped in a `<Sequence from={CTA_START}>` in Video.tsx, so `useCurrentFrame()` returns local frame starting at 0:

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, AbsoluteFill } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import { COLORS } from '../lib/theme';

const { fontFamily } = loadFont('normal', {
  weights: ['500', '700'],
  subsets: ['latin'],
});

const PHRASES = ['Your finances.', 'Your data.', 'Your control.'];

export const ClosingCta: React.FC = () => {
  const frame = useCurrentFrame(); // local frame (0 = when CTA starts)
  const { fps } = useVideoConfig();

  // Background blur overlay
  const overlayOpacity = interpolate(frame, [0, 30], [0, 0.6], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // GitHub link appears after all phrases
  const linkDelay = PHRASES.length * fps; // 3s after CTA start
  const linkOpacity = interpolate(frame - linkDelay, [0, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const underlineWidth = interpolate(frame - linkDelay, [5, 20], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: `rgba(29, 29, 31, ${overlayOpacity})`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily,
        backdropFilter: frame > 0 ? 'blur(4px)' : undefined,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        {PHRASES.map((phrase, i) => {
          const phraseDelay = i * fps; // 1s apart
          const phraseOpacity = interpolate(frame - phraseDelay, [0, 20], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          const translateY = interpolate(frame - phraseDelay, [0, 20], [15, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });

          return (
            <div
              key={phrase}
              style={{
                fontSize: 52,
                fontWeight: 700,
                color: COLORS.white,
                letterSpacing: -0.5,
                opacity: phraseOpacity,
                transform: `translateY(${translateY}px)`,
              }}
            >
              {phrase}
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 40,
          opacity: linkOpacity,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 22, fontWeight: 500, color: COLORS.secondaryText }}>
          github.com/your-username/money-monitor
        </span>
        <div
          style={{
            height: 2,
            backgroundColor: COLORS.secondaryText,
            width: `${underlineWidth}%`,
            marginTop: 4,
            borderRadius: 1,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/scenes/ClosingCta.tsx
git commit -m "feat(video): add ClosingCta scene with sequential phrase reveal"
```

---

## Chunk 4: Assembly & Polish

### Task 19: Wire all scenes into Canvas

**Files:**

- Modify: `video/src/Canvas.tsx`

- [ ] **Step 1: Update Canvas to include all scenes**

Replace `video/src/Canvas.tsx` with:

```tsx
import React from 'react';
import { Sequence } from 'remotion';
import { CANVAS, COLORS, VIDEO } from './lib/theme';
import { KEYFRAMES } from './lib/camera-keyframes';
import { Sidebar } from './components/Sidebar';
import { TitleCard } from './scenes/TitleCard';
import { Dashboard } from './scenes/Dashboard';
import { AiChat } from './scenes/AiChat';
import { NetWorth } from './scenes/NetWorth';
import { Accounts } from './scenes/Accounts';
import { Scraping } from './scenes/Scraping';

// Scene start frames from camera keyframes
const SCENE_FRAMES = {
  title: KEYFRAMES[0].frame, // 0
  dashboard: KEYFRAMES[2].frame, // 300
  aiChat: KEYFRAMES[3].frame, // 750
  netWorth: KEYFRAMES[4].frame, // 1200
  accounts: KEYFRAMES[5].frame, // 1560
  scraping: KEYFRAMES[6].frame, // 1740
};

export const Canvas: React.FC = () => {
  return (
    <div
      style={{
        width: CANVAS.width,
        height: CANVAS.height,
        background: COLORS.background,
        position: 'relative',
      }}
    >
      {/* Sidebar — always visible, no sequence needed */}
      <Sidebar />

      {/* Each scene wrapped in Sequence so useCurrentFrame() returns local frame.
          layout="none" prevents Sequence from adding AbsoluteFill wrapper.
          premountFor={30} pre-renders 1s before the scene starts. */}
      <Sequence from={SCENE_FRAMES.title} layout="none" premountFor={30}>
        <TitleCard />
      </Sequence>

      <Sequence from={SCENE_FRAMES.dashboard} layout="none" premountFor={30}>
        <Dashboard />
      </Sequence>

      <Sequence from={SCENE_FRAMES.aiChat} layout="none" premountFor={30}>
        <AiChat />
      </Sequence>

      <Sequence from={SCENE_FRAMES.netWorth} layout="none" premountFor={30}>
        <NetWorth />
      </Sequence>

      <Sequence from={SCENE_FRAMES.accounts} layout="none" premountFor={30}>
        <Accounts />
      </Sequence>

      <Sequence from={SCENE_FRAMES.scraping} layout="none" premountFor={30}>
        <Scraping />
      </Sequence>
    </div>
  );
};
```

**Important:** Because each scene is now wrapped in `<Sequence>`, `useCurrentFrame()` inside each scene returns a _local_ frame starting from 0 when that scene begins. This means all animation delays in scene components (e.g., `delay={15}` in Dashboard) are relative to the camera arriving at that scene — not the global timeline. This is the correct behavior.

- [ ] **Step 2: Update Video to include ClosingCta**

Update `video/src/Video.tsx`:

```tsx
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Camera } from './Camera';
import { Canvas } from './Canvas';
import { FeatureLabel } from './FeatureLabel';
import { ClosingCta } from './scenes/ClosingCta';
import { COLORS } from './lib/theme';

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.text }}>
      <Camera>
        <Canvas />
      </Camera>
      <FeatureLabel />
      <ClosingCta />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 3: Verify in Remotion Studio**

```bash
cd /Users/saaramrani/projects/money-monitor/video
npx remotion studio
```

Expected: Full video plays with camera flying through all scenes. Scrub through to verify:

- 0-8s: Title card with logo + text
- 8-10s: Zoom out to full app
- 10-25s: Dashboard with charts animating
- 25-40s: AI Chat with typewriter
- 40-52s: Net Worth with line chart drawing
- 52-58s: Bank cards fanning in
- 58-67s: Scraping progress bars
- 67-75s: Pull back + CTA text

- [ ] **Step 4: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/Canvas.tsx video/src/Video.tsx
git commit -m "feat(video): wire all scenes into Canvas and Video"
```

---

### Task 20: Add audio support

**Files:**

- Modify: `video/src/Video.tsx`

- [ ] **Step 1: Add conditional Audio component**

Update `video/src/Video.tsx` to include audio:

```tsx
import React from 'react';
import { AbsoluteFill, Audio, staticFile, interpolate, useVideoConfig, Sequence } from 'remotion';
import { Camera } from './Camera';
import { Canvas } from './Canvas';
import { FeatureLabel } from './FeatureLabel';
import { ClosingCta } from './scenes/ClosingCta';
import { COLORS, VIDEO } from './lib/theme';
import { KEYFRAMES } from './lib/camera-keyframes';

const CTA_START = KEYFRAMES[KEYFRAMES.length - 1].frame;

// Wrapper that silently skips Audio if the file doesn't exist
const OptionalAudio: React.FC = () => {
  const { durationInFrames } = useVideoConfig();

  // staticFile will throw during render if file doesn't exist.
  // Wrap in try/catch at module level isn't possible, so we use
  // a known path and let users place the file when ready.
  // If missing, Remotion shows an error only during render —
  // remove this component or add the file.
  return (
    <Audio
      src={staticFile('music.mp3')}
      volume={(f) => {
        const fadeIn = interpolate(f, [0, 30], [0, 0.3], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const fadeOut = interpolate(f, [durationInFrames - 60, durationInFrames], [0.3, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        return Math.min(fadeIn, fadeOut);
      }}
    />
  );
};

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.text }}>
      <Camera>
        <Canvas />
      </Camera>
      <FeatureLabel />
      <Sequence from={CTA_START} premountFor={30} layout="none">
        <ClosingCta />
      </Sequence>
      {/* Uncomment when music.mp3 is placed in public/ */}
      {/* <OptionalAudio /> */}
    </AbsoluteFill>
  );
};
```

When ready to add music, place a royalty-free `.mp3` at `video/public/music.mp3` and uncomment `<OptionalAudio />`.

- [ ] **Step 2: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/src/Video.tsx
git commit -m "feat(video): add background music with fade in/out"
```

---

### Task 21: Add .gitignore and final polish

**Files:**

- Create: `video/.gitignore`
- Modify: `.gitignore` (root)

- [ ] **Step 1: Create video/.gitignore**

Create `video/.gitignore`:

```
node_modules/
out/
dist/
.remotion/
```

- [ ] **Step 2: Add .superpowers to root .gitignore**

Append `.superpowers/` to the root `.gitignore` if not already present.

- [ ] **Step 3: Final verification in Remotion Studio**

```bash
cd /Users/saaramrani/projects/money-monitor/video
npx remotion studio
```

Scrub through the entire 75-second video. Check:

- [ ] Camera transitions are smooth (no jank)
- [ ] Feature labels appear/disappear at correct times
- [ ] All chart animations trigger when the camera arrives
- [ ] Typewriter effect in AI Chat looks natural
- [ ] Bank cards fan animation feels right
- [ ] CTA text fades in sequentially
- [ ] No elements overlap unexpectedly

- [ ] **Step 4: Test rendering**

```bash
cd /Users/saaramrani/projects/money-monitor/video
npx remotion render src/Root.tsx MoneyMonitorShowcase out/showcase.mp4
```

Expected: `out/showcase.mp4` is created, ~75 seconds, 1920×1080. Inspect the file to confirm quality.

- [ ] **Step 5: Commit**

```bash
cd /Users/saaramrani/projects/money-monitor
git add video/.gitignore .gitignore
git commit -m "chore(video): add gitignore and finalize project"
```

---

## Camera Tuning Notes

After all scenes are wired up, the camera keyframe coordinates will likely need adjustment. Open Remotion Studio and scrub through the video. For each scene:

1. Pause at the frame where the camera should be fully settled on a zone
2. If the zone isn't centered well in the viewport, adjust the `x` and `y` values in `camera-keyframes.ts`
3. If the zoom feels too tight or loose, adjust the `zoom` value
4. If the transition feels too fast/slow, adjust the `frame` gap between keyframes

The keyframe values in the spec are starting estimates. This tuning is an iterative visual process best done in Remotion Studio's preview.
