import { Type } from '@sinclair/typebox';
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
      'View the current Telegram alert configuration. Shows which alerts are enabled and their thresholds.',
    label: 'Checking alert settings',
    parameters: Type.Object({}),
    execute: async () => {
      return JSON.stringify(getPublicSettings(), null, 2);
    },
  });
}

export function buildUpdateAlertSettingsTool() {
  return createAgentTool({
    name: 'update_alert_settings',
    description:
      'Update Telegram alert settings. You can enable/disable the master switch or individual alerts, and adjust thresholds. ' +
      'Available alerts: dailyDigest (post-scrape summary), unusualSpending (spending spike detection), ' +
      'newRecurring (new subscription detection), reviewReminder (uncategorized transaction reminder), ' +
      'monthlySummary (monthly financial report), netWorthChange (net worth milestone/change alerts).',
    label: 'Updating alert settings',
    parameters: Type.Object({
      enabled: Type.Optional(Type.Boolean({ description: 'Master switch for all alerts' })),
      daily_digest_enabled: Type.Optional(
        Type.Boolean({ description: 'Enable post-scrape daily digest' }),
      ),
      daily_digest_large_charge_threshold: Type.Optional(
        Type.Number({
          description: 'Minimum amount to flag as a large charge (positive number, e.g. 500)',
        }),
      ),
      daily_digest_report_errors: Type.Optional(
        Type.Boolean({ description: 'Report scrape failures in digest' }),
      ),
      unusual_spending_enabled: Type.Optional(
        Type.Boolean({ description: 'Enable unusual spending alerts' }),
      ),
      unusual_spending_percent_threshold: Type.Optional(
        Type.Number({ description: 'Percentage increase to trigger alert (e.g. 30 = 30% spike)' }),
      ),
      new_recurring_enabled: Type.Optional(
        Type.Boolean({ description: 'Enable new recurring charge detection' }),
      ),
      review_reminder_enabled: Type.Optional(
        Type.Boolean({ description: 'Enable low-confidence categorization reminders' }),
      ),
      monthly_summary_enabled: Type.Optional(
        Type.Boolean({ description: 'Enable monthly summary' }),
      ),
      monthly_summary_day: Type.Optional(
        Type.Number({ description: 'Day of month to send the summary (1–28)' }),
      ),
      net_worth_change_enabled: Type.Optional(
        Type.Boolean({ description: 'Enable net worth change alerts' }),
      ),
      net_worth_change_threshold: Type.Optional(
        Type.Number({ description: 'Minimum ILS change to trigger net worth alert' }),
      ),
      net_worth_milestone_interval: Type.Optional(
        Type.Number({ description: 'Net worth milestone interval in ILS (e.g. 100000)' }),
      ),
    }),
    execute: async (args) => {
      const patch: Partial<AlertPublicSettings> = {};

      if (args.enabled !== undefined) patch.enabled = args.enabled;

      if (
        args.daily_digest_enabled !== undefined ||
        args.daily_digest_large_charge_threshold !== undefined ||
        args.daily_digest_report_errors !== undefined
      ) {
        patch.dailyDigest = {} as AlertPublicSettings['dailyDigest'];
        if (args.daily_digest_enabled !== undefined)
          patch.dailyDigest.enabled = args.daily_digest_enabled;
        if (args.daily_digest_large_charge_threshold !== undefined)
          patch.dailyDigest.largeChargeThreshold = args.daily_digest_large_charge_threshold;
        if (args.daily_digest_report_errors !== undefined)
          patch.dailyDigest.reportErrors = args.daily_digest_report_errors;
      }

      if (
        args.unusual_spending_enabled !== undefined ||
        args.unusual_spending_percent_threshold !== undefined
      ) {
        patch.unusualSpending = {} as AlertPublicSettings['unusualSpending'];
        if (args.unusual_spending_enabled !== undefined)
          patch.unusualSpending.enabled = args.unusual_spending_enabled;
        if (args.unusual_spending_percent_threshold !== undefined)
          patch.unusualSpending.percentThreshold = args.unusual_spending_percent_threshold;
      }

      if (args.new_recurring_enabled !== undefined)
        patch.newRecurring = { enabled: args.new_recurring_enabled };
      if (args.review_reminder_enabled !== undefined)
        patch.reviewReminder = { enabled: args.review_reminder_enabled };
      if (args.monthly_summary_enabled !== undefined || args.monthly_summary_day !== undefined) {
        patch.monthlySummary = {} as AlertPublicSettings['monthlySummary'];
        if (args.monthly_summary_enabled !== undefined)
          patch.monthlySummary.enabled = args.monthly_summary_enabled;
        if (args.monthly_summary_day !== undefined)
          patch.monthlySummary.dayOfMonth = args.monthly_summary_day;
      }

      if (
        args.net_worth_change_enabled !== undefined ||
        args.net_worth_change_threshold !== undefined ||
        args.net_worth_milestone_interval !== undefined
      ) {
        patch.netWorthChange = {} as AlertPublicSettings['netWorthChange'];
        if (args.net_worth_change_enabled !== undefined)
          patch.netWorthChange.enabled = args.net_worth_change_enabled;
        if (args.net_worth_change_threshold !== undefined)
          patch.netWorthChange.changeThreshold = args.net_worth_change_threshold;
        if (args.net_worth_milestone_interval !== undefined)
          patch.netWorthChange.milestoneInterval = args.net_worth_milestone_interval;
      }

      updateAlertSettings(patch);
      return JSON.stringify({ success: true, settings: getPublicSettings() }, null, 2);
    },
  });
}
