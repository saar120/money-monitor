import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../paths.js';

const SETTINGS_DIR = join(dataDir, 'chat');
const SETTINGS_PATH = join(SETTINGS_DIR, 'alert-settings.json');

export interface AlertSettings {
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

  /** Last known net worth total (for milestone tracking) */
  _lastNetWorthTotal?: number;

  /** Known recurring charge descriptions (to detect new ones) */
  _knownRecurring?: string[];
}

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
    cache = { ...DEFAULT_SETTINGS, ...raw };
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache!;
}

export function saveAlertSettings(settings: AlertSettings): void {
  cache = settings;
  ensureDir();
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

export function updateAlertSettings(partial: Partial<AlertSettings>): AlertSettings {
  const current = loadAlertSettings();
  const updated = deepMerge(current, partial) as AlertSettings;
  saveAlertSettings(updated);
  return updated;
}

export function getDefaultSettings(): AlertSettings {
  return { ...DEFAULT_SETTINGS };
}

/** Deep merge, preserving nested objects */
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
