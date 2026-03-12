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

  /** Post-scrape daily digest */
  dailyDigest: {
    enabled: boolean;
    /** Threshold (positive number) for flagging large charges */
    largeChargeThreshold: number;
    /** Report scrape failures */
    reportErrors: boolean;
  };

  /** Unusual spending alert */
  unusualSpending: {
    enabled: boolean;
    /** Percentage increase threshold to trigger alert (e.g. 30 = 30%) */
    percentThreshold: number;
  };

  /** New recurring charge detected */
  newRecurring: {
    enabled: boolean;
  };

  /** Low-confidence categorization review */
  reviewReminder: {
    enabled: boolean;
  };

  /** Monthly summary (1st of month) */
  monthlySummary: {
    enabled: boolean;
  };

  /** Net worth milestone / change */
  netWorthChange: {
    enabled: boolean;
    /** Minimum absolute change in ILS to trigger alert */
    changeThreshold: number;
    /** Track milestone crossings at these intervals */
    milestoneInterval: number;
  };
}

/** Full settings including internal tracking state. */
export type AlertSettings = AlertPublicSettings & AlertInternalState;

const DEFAULT_SETTINGS: AlertSettings = {
  enabled: true,
  dailyDigest: {
    enabled: true,
    largeChargeThreshold: 500,
    reportErrors: true,
  },
  unusualSpending: {
    enabled: true,
    percentThreshold: 30,
  },
  newRecurring: {
    enabled: true,
  },
  reviewReminder: {
    enabled: true,
  },
  monthlySummary: {
    enabled: true,
  },
  netWorthChange: {
    enabled: true,
    changeThreshold: 10000,
    milestoneInterval: 100000,
  },
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
  const settings = loadAlertSettings();
  delete settings._lastNetWorthTotal;
  delete settings._knownRecurring;
  return settings;
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
