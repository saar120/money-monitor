import type { FastifyInstance } from 'fastify';
import {
  updateAlertSettings,
  getDefaultSettings,
  getPublicSettings,
  type AlertPublicSettings,
} from '../telegram/alert-settings.js';
import { runPostScrapeAlerts } from '../telegram/alerts.js';

/** Pick only known public keys from an untrusted body. */
function pickPublicFields(body: Record<string, unknown>): Partial<AlertPublicSettings> {
  const patch: Partial<AlertPublicSettings> = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (typeof body.largeChargeThreshold === 'number')
    patch.largeChargeThreshold = body.largeChargeThreshold;
  if (typeof body.unusualSpendingPercent === 'number')
    patch.unusualSpendingPercent = body.unusualSpendingPercent;
  if (typeof body.reportScrapeErrors === 'boolean')
    patch.reportScrapeErrors = body.reportScrapeErrors;
  if (body.monthlySummary && typeof body.monthlySummary === 'object') {
    const ms = body.monthlySummary as Record<string, unknown>;
    const sub: Partial<AlertPublicSettings['monthlySummary']> = {};
    if (typeof ms.enabled === 'boolean') sub.enabled = ms.enabled;
    if (typeof ms.dayOfMonth === 'number') sub.dayOfMonth = ms.dayOfMonth;
    if (Object.keys(sub).length > 0)
      patch.monthlySummary = sub as AlertPublicSettings['monthlySummary'];
  }
  return patch;
}

export async function alertsRoutes(app: FastifyInstance) {
  /** Get current alert settings */
  app.get('/api/alerts/settings', async (_request, reply) => {
    return reply.send(getPublicSettings());
  });

  /** Update alert settings (partial merge) */
  app.patch('/api/alerts/settings', async (request, reply) => {
    const patch = pickPublicFields(request.body as Record<string, unknown>);
    updateAlertSettings(patch);
    return reply.send(getPublicSettings());
  });

  /** Reset alert settings to defaults */
  app.post('/api/alerts/settings/reset', async (_request, reply) => {
    updateAlertSettings(getDefaultSettings());
    return reply.send(getPublicSettings());
  });

  /** Send a test alert to all connected Telegram chats */
  app.post('/api/alerts/test', async (_request, reply) => {
    try {
      await runPostScrapeAlerts([]);
      return reply.send({ success: true, message: 'Test alert sent' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });
}
