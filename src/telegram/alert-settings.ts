import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../paths.js';

const SETTINGS_DIR = join(dataDir, 'chat');
const SETTINGS_PATH = join(SETTINGS_DIR, 'alert-settings.json');

/** Internal tracking state (not exposed to clients). */
export interface AlertInternalState {
  _lastNetWorthTotal?: number;
  _knownRecurring?: string[];
}

/** Public alert settings (exposed via API and UI). */
export interface AlertPublicSettings {
  /** Master switch for all alerts */
  enabled: boolean;
  /** Threshold (positive number) for flagging large charges */
  largeChargeThreshold: number;
  /** Percentage increase threshold for unusual spending (e.g. 30 = 30%) */
  unusualSpendingPercent: number;
  /** Monthly summary schedule */
  monthlySummary: {
    enabled: boolean;
    /** Day of month to send the summary (1–28, default 1) */
    dayOfMonth: number;
  };
  /** Report scrape failures in alerts */
  reportScrapeErrors: boolean;
}

/** Full settings including internal tracking state. */
export type AlertSettings = AlertPublicSettings & AlertInternalState;

const DEFAULT_SETTINGS: AlertSettings = {
  enabled: true,
  largeChargeThreshold: 500,
  unusualSpendingPercent: 30,
  monthlySummary: {
    enabled: true,
    dayOfMonth: 1,
  },
  reportScrapeErrors: true,
};

let cache: AlertSettings | null = null;

function ensureDir() {
  mkdirSync(SETTINGS_DIR, { recursive: true });
}

export function loadAlertSettings(): AlertSettings {
  if (cache) return cache;
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    cache = deepMerge(DEFAULT_SETTINGS, raw);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT')
      throw err;
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

export function saveAlertSettings(settings: AlertSettings): void {
  cache = settings;
  ensureDir();
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

export function updateAlertSettings(partial: Partial<AlertSettings>): AlertSettings {
  const current = loadAlertSettings();
  const updated = deepMerge(current, partial);
  saveAlertSettings(updated);
  return updated;
}

export function getDefaultSettings(): AlertSettings {
  return { ...DEFAULT_SETTINGS };
}

/** Return settings stripped of internal tracking fields (safe for API responses). */
export function getPublicSettings(): AlertPublicSettings {
  const copy = { ...loadAlertSettings() };
  delete copy._lastNetWorthTotal;
  delete copy._knownRecurring;
  return copy;
}

/** Deep merge, preserving nested objects. */
function deepMerge(target: AlertSettings, source: Partial<AlertSettings>): AlertSettings {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof AlertSettings>) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      Object.assign(result, { [key]: { ...tv, ...sv } });
    } else if (sv !== undefined) {
      Object.assign(result, { [key]: sv });
    }
  }
  return result;
}
