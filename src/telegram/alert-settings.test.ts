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

  describe('getDefaultSettings', () => {
    it('returns default settings with all sections enabled', () => {
      const defaults = getDefaultSettings();
      expect(defaults.enabled).toBe(true);
      expect(defaults.dailyDigest.enabled).toBe(true);
      expect(defaults.unusualSpending.enabled).toBe(true);
      expect(defaults.newRecurring.enabled).toBe(true);
      expect(defaults.reviewReminder.enabled).toBe(true);
      expect(defaults.monthlySummary.enabled).toBe(true);
      expect(defaults.netWorthChange.enabled).toBe(true);
    });

    it('returns default threshold values', () => {
      const defaults = getDefaultSettings();
      expect(defaults.dailyDigest.largeChargeThreshold).toBe(500);
      expect(defaults.unusualSpending.percentThreshold).toBe(30);
      expect(defaults.netWorthChange.changeThreshold).toBe(10000);
      expect(defaults.netWorthChange.milestoneInterval).toBe(100000);
    });

    it('returns a new object each time', () => {
      const a = getDefaultSettings();
      const b = getDefaultSettings();
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe('loadAlertSettings', () => {
    it('returns defaults when no settings file exists', () => {
      const loaded = loadAlertSettings();
      expect(loaded.enabled).toBe(true);
      expect(loaded.dailyDigest.enabled).toBe(true);
      expect(loaded.dailyDigest.largeChargeThreshold).toBe(500);
    });

    it('returns cached settings on subsequent calls', () => {
      const first = loadAlertSettings();
      const second = loadAlertSettings();
      expect(first).toBe(second); // same object reference
    });
  });

  describe('saveAlertSettings', () => {
    it('persists settings to disk as JSON', () => {
      const settings = getDefaultSettings();
      settings.enabled = false;
      saveAlertSettings(settings);

      const raw = readFileSync(join(TEST_DIR, 'chat', 'alert-settings.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.enabled).toBe(false);
    });

    it('updates cache so load returns new values', () => {
      const settings = getDefaultSettings();
      settings.dailyDigest.largeChargeThreshold = 1000;
      saveAlertSettings(settings);

      const loaded = loadAlertSettings();
      expect(loaded.dailyDigest.largeChargeThreshold).toBe(1000);
    });
  });

  describe('updateAlertSettings', () => {
    it('merges partial updates into existing settings', () => {
      const updated = updateAlertSettings({ enabled: false });
      expect(updated.enabled).toBe(false);
      expect(updated.dailyDigest.enabled).toBe(true);
      expect(updated.unusualSpending.percentThreshold).toBe(30);
    });

    it('deep merges nested objects (partial update preserves sibling keys)', () => {
      const updated = updateAlertSettings({
        dailyDigest: { largeChargeThreshold: 1000 } as any,
      });

      expect(updated.dailyDigest.largeChargeThreshold).toBe(1000);
      expect(updated.dailyDigest.enabled).toBe(true);
      expect(updated.dailyDigest.reportErrors).toBe(true);
    });

    it('deep merges multiple nested sections at once', () => {
      const updated = updateAlertSettings({
        unusualSpending: { percentThreshold: 50 } as any,
        netWorthChange: { changeThreshold: 20000 } as any,
      });

      expect(updated.unusualSpending.percentThreshold).toBe(50);
      expect(updated.unusualSpending.enabled).toBe(true);
      expect(updated.netWorthChange.changeThreshold).toBe(20000);
      expect(updated.netWorthChange.milestoneInterval).toBe(100000);
    });

    it('replaces array values instead of merging them', () => {
      updateAlertSettings({ _knownRecurring: ['Netflix', 'Spotify'] });
      const updated = updateAlertSettings({
        _knownRecurring: ['Netflix', 'Spotify', 'Disney+'],
      });
      expect(updated._knownRecurring).toEqual(['Netflix', 'Spotify', 'Disney+']);
    });

    it('handles _lastNetWorthTotal tracking field', () => {
      const updated = updateAlertSettings({ _lastNetWorthTotal: 500000 });
      expect(updated._lastNetWorthTotal).toBe(500000);
    });
  });

  describe('getPublicSettings', () => {
    it('strips internal tracking fields', () => {
      saveAlertSettings({
        ...getDefaultSettings(),
        _lastNetWorthTotal: 500000,
        _knownRecurring: ['Netflix'],
      });

      const pub = getPublicSettings();
      expect(pub).not.toHaveProperty('_lastNetWorthTotal');
      expect(pub).not.toHaveProperty('_knownRecurring');
      expect(pub.enabled).toBe(true);
    });
  });
});
