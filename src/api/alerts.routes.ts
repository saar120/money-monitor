import type { FastifyInstance } from 'fastify';
import {
  loadAlertSettings,
  updateAlertSettings,
  getDefaultSettings,
  type AlertSettings,
} from '../telegram/alert-settings.js';

export async function alertsRoutes(app: FastifyInstance) {
  /** Get current alert settings */
  app.get('/api/alerts/settings', async (_request, reply) => {
    const settings = loadAlertSettings();
    // Strip internal tracking fields from response
    const { _lastNetWorthTotal, _knownRecurring, ...publicSettings } = settings;
    return reply.send(publicSettings);
  });

  /** Update alert settings (partial merge) */
  app.patch('/api/alerts/settings', async (request, reply) => {
    const body = request.body as Partial<AlertSettings>;
    const updated = updateAlertSettings(body);
    const { _lastNetWorthTotal, _knownRecurring, ...publicSettings } = updated;
    return reply.send(publicSettings);
  });

  /** Reset alert settings to defaults */
  app.post('/api/alerts/settings/reset', async (_request, reply) => {
    const defaults = getDefaultSettings();
    const updated = updateAlertSettings(defaults);
    const { _lastNetWorthTotal, _knownRecurring, ...publicSettings } = updated;
    return reply.send(publicSettings);
  });

  /** Send a test alert to all connected Telegram chats */
  app.post('/api/alerts/test', async (_request, reply) => {
    const { sendPostScrapeDigest } = await import('../telegram/alerts.js');
    try {
      // Send a minimal test digest
      await sendPostScrapeDigest([]);
      return reply.send({ success: true, message: 'Test alert sent' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });
}
