import { Type } from '@earendil-works/pi-ai';
import { createAgentTool } from './tool-adapter.js';
import {
  updateAlertSettings,
  getPublicSettings,
  type AlertPublicSettings,
} from '../telegram/alert-settings.js';

export function buildGetAlertSettingsTool() {
  return createAgentTool({
    name: 'get_alert_settings',
    description:
      'View the current Telegram alert configuration. Shows thresholds and whether alerts are enabled.',
    label: 'Checking alert settings',
    parameters: Type.Object({}),
    execute: async () => getAlertSettings(),
  });
}

export function buildUpdateAlertSettingsTool() {
  return createAgentTool({
    name: 'update_alert_settings',
    description:
      'Update Telegram alert settings. You can enable/disable the master switch, adjust thresholds, ' +
      'or configure the monthly summary schedule.',
    label: 'Updating alert settings',
    parameters: Type.Object({
      enabled: Type.Optional(Type.Boolean({ description: 'Master switch for all alerts' })),
      large_charge_threshold: Type.Optional(
        Type.Number({
          description: 'Minimum amount to flag as a large charge (positive number, e.g. 500)',
        }),
      ),
      unusual_spending_percent: Type.Optional(
        Type.Number({ description: 'Percentage increase to trigger alert (e.g. 30 = 30% spike)' }),
      ),
      monthly_summary_enabled: Type.Optional(
        Type.Boolean({ description: 'Enable monthly summary' }),
      ),
      monthly_summary_day: Type.Optional(
        Type.Number({ description: 'Day of month to send the summary (1–28)' }),
      ),
      report_scrape_errors: Type.Optional(
        Type.Boolean({ description: 'Report scrape failures in alerts' }),
      ),
    }),
    execute: async (args) => updateAlertSettingsFromTool(args),
  });
}

export function getAlertSettings(): string {
  return JSON.stringify(getPublicSettings(), null, 2);
}

export function updateAlertSettingsFromTool(input: {
  enabled?: boolean;
  large_charge_threshold?: number;
  unusual_spending_percent?: number;
  monthly_summary_enabled?: boolean;
  monthly_summary_day?: number;
  report_scrape_errors?: boolean;
}): string {
  const patch: Partial<AlertPublicSettings> = {};

  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.large_charge_threshold !== undefined)
    patch.largeChargeThreshold = input.large_charge_threshold;
  if (input.unusual_spending_percent !== undefined)
    patch.unusualSpendingPercent = input.unusual_spending_percent;
  if (input.report_scrape_errors !== undefined)
    patch.reportScrapeErrors = input.report_scrape_errors;

  if (input.monthly_summary_enabled !== undefined || input.monthly_summary_day !== undefined) {
    patch.monthlySummary = {} as AlertPublicSettings['monthlySummary'];
    if (input.monthly_summary_enabled !== undefined)
      patch.monthlySummary.enabled = input.monthly_summary_enabled;
    if (input.monthly_summary_day !== undefined)
      patch.monthlySummary.dayOfMonth = input.monthly_summary_day;
  }

  updateAlertSettings(patch);
  return JSON.stringify({ success: true, settings: getPublicSettings() }, null, 2);
}
