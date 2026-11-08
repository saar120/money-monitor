import {
  pauseAlertEvaluations,
  resumeAlertEvaluations,
  drainAlertEvaluations,
} from '../telegram/alerts.js';
import {
  pauseTelegramDeliveries,
  resumeTelegramDeliveries,
  drainTelegramDeliveries,
} from '../telegram/delivery.js';
import { clearReplyImages } from '../ai/image-tools.js';
import { startTelegramBot, stopTelegramBot } from '../telegram/bot.js';
import { advisorReplies } from '../ai/advisor-replies.js';
import type { FastifyInstance } from 'fastify';
import { isDemoMode, swapToDemo, swapToReal } from '../db/connection.js';
import { seedDemoData } from '../db/demo-seed.js';
import {
  pauseScrapeAdmission,
  resumeScrapeAdmission,
  drainScrapeSessions,
} from '../scraper/session-manager.js';
import { drainPostImports } from '../services/post-import.js';
import { stopScheduler, startScheduler } from '../scraper/scheduler.js';

export async function demoRoutes(app: FastifyInstance) {
  let transition: Promise<void> | null = null;

  app.get('/api/demo/status', async (_request, reply) => {
    return reply.send({ demoMode: isDemoMode() });
  });

  app.post('/api/demo/toggle', async (request, reply) => {
    const body = request.body as { enabled?: boolean } | null;
    const enabled = body?.enabled ?? !isDemoMode();

    if (transition) return reply.status(409).send({ error: 'A data-mode change is in progress.' });
    if (typeof enabled !== 'boolean')
      return reply.status(400).send({ error: 'enabled must be a boolean' });
    transition = (async () => {
      pauseScrapeAdmission();
      advisorReplies.pause();
      pauseAlertEvaluations();
      pauseTelegramDeliveries();
      stopScheduler();
      try {
        const replies = advisorReplies.drain(true);
        const telegram = Promise.resolve(stopTelegramBot());
        void telegram.catch(() => {});
        await drainScrapeSessions();
        await drainPostImports();
        await replies;
        await drainAlertEvaluations();
        await drainTelegramDeliveries();
        await telegram;
        clearReplyImages();
        if (enabled && !isDemoMode()) swapToDemo(seedDemoData);
        else if (!enabled && isDemoMode()) swapToReal();
      } finally {
        resumeScrapeAdmission();
        advisorReplies.resume();
        resumeAlertEvaluations();
        resumeTelegramDeliveries();
        await startTelegramBot();
        if (!isDemoMode()) startScheduler();
      }
    })();
    try {
      await transition;
    } finally {
      transition = null;
    }

    return reply.send({ success: true, demoMode: isDemoMode() });
  });
}
