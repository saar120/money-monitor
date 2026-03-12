import type { FastifyInstance } from 'fastify';
import {
  updateAlertSettings,
  getDefaultSettings,
  getPublicSettings,
  type AlertPublicSettings,
} from '../telegram/alert-settings.js';

export async function alertsRoutes(app: FastifyInstance) {
  /** Get current alert settings */
  app.get('/api/alerts/settings', async (_request, reply) => {
    return reply.send(getPublicSettings());
  });

  /** Update alert settings (partial merge) */
  app.patch('/api/alerts/settings', async (request, reply) => {
    const body = request.body as Partial<AlertPublicSettings>;
    updateAlertSettings(body);
    return reply.send(getPublicSettings());
  });

  /** Reset alert settings to defaults */
  app.post('/api/alerts/settings/reset', async (_request, reply) => {
    updateAlertSettings(getDefaultSettings());
    return reply.send(getPublicSettings());
  });

  /** Send a test alert to all connected Telegram chats */
  app.post('/api/alerts/test', async (_request, reply) => {
    const { runPostScrapeAlerts } = await import('../telegram/alerts.js');
    try {
      await runPostScrapeAlerts([]);
      return reply.send({ success: true, message: 'Test alert sent' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });
}
