import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `alert-settings-test-${process.pid}`);

// Mock paths before importing the module
vi.mock('../paths.js', () => ({
  dataDir: TEST_DIR,
}));

describe('alert-settings', () => {
  // Re-import the module for each test to clear the cache
  let loadAlertSettings: (typeof import('./alert-settings.js'))['loadAlertSettings'];
  let saveAlertSettings: (typeof import('./alert-settings.js'))['saveAlertSettings'];
  let updateAlertSettings: (typeof import('./alert-settings.js'))['updateAlertSettings'];
  let getDefaultSettings: (typeof import('./alert-settings.js'))['getDefaultSettings'];
  let getPublicSettings: (typeof import('./alert-settings.js'))['getPublicSettings'];

  beforeEach(async () => {
    // Clean up test dir
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, 'chat'), { recursive: true });

    // Reset module to clear cache
    vi.resetModules();
    const mod = await import('./alert-settings.js');
    loadAlertSettings = mod.loadAlertSettings;
    saveAlertSettings = mod.saveAlertSettings;
    updateAlertSettings = mod.updateAlertSettings;
    getDefaultSettings = mod.getDefaultSettings;
    getPublicSettings = mod.getPublicSettings;
  });

  describe('loadAlertSettings', () => {
    it('returns defaults when no settings file exists', () => {
      const loaded = loadAlertSettings();
      expect(loaded).toEqual({
        enabled: true,
        largeChargeThreshold: 500,
        unusualSpendingPercent: 30,
        monthlySummary: { enabled: true, dayOfMonth: 1 },
        reportScrapeErrors: true,
      });
    });
  });

  describe('saveAlertSettings', () => {
    it('persists settings to disk and updates subsequent loads', () => {
      const settings = getDefaultSettings();
      settings.enabled = false;
      settings.largeChargeThreshold = 1000;
      saveAlertSettings(settings);

      const raw = readFileSync(join(TEST_DIR, 'chat', 'alert-settings.json'), 'utf-8');
      expect(JSON.parse(raw)).toMatchObject({ enabled: false, largeChargeThreshold: 1000 });
      expect(loadAlertSettings()).toMatchObject({ enabled: false, largeChargeThreshold: 1000 });
    });
  });

  describe('updateAlertSettings', () => {
    it('merges partial updates into existing settings', () => {
      const updated = updateAlertSettings({ enabled: false });
      expect(updated.enabled).toBe(false);
      expect(updated.largeChargeThreshold).toBe(500);
      expect(updated.unusualSpendingPercent).toBe(30);
    });

    it('deep merges nested monthlySummary (partial update preserves sibling keys)', () => {
      const updated = updateAlertSettings({
        monthlySummary: { dayOfMonth: 15 } as any,
      });

      expect(updated.monthlySummary.dayOfMonth).toBe(15);
      expect(updated.monthlySummary.enabled).toBe(true);
    });

    it('replaces array values instead of merging them', () => {
      updateAlertSettings({ _knownRecurring: ['Netflix', 'Spotify'] });
      const updated = updateAlertSettings({
        _knownRecurring: ['Netflix', 'Spotify', 'Disney+'],
      });
      expect(updated._knownRecurring).toEqual(['Netflix', 'Spotify', 'Disney+']);
    });
  });

  describe('getPublicSettings', () => {
    it('strips internal tracking fields', () => {
      saveAlertSettings({
        ...getDefaultSettings(),
        _lastAlertEvaluationId: 7,
        _lastNetWorthTotal: 500000,
        _knownRecurring: ['Netflix'],
      });

      const pub = getPublicSettings();
      expect(pub).not.toHaveProperty('_lastAlertEvaluationId');
      expect(pub).not.toHaveProperty('_lastNetWorthTotal');
      expect(pub).not.toHaveProperty('_knownRecurring');
      expect(pub.enabled).toBe(true);
    });
  });
});
