import type { FastifyInstance } from 'fastify';
import { isDemoMode, swapToDemo, swapToReal } from '../db/connection.js';
import { seedDemoData } from '../db/demo-seed.js';
import { stopScheduler, startScheduler } from '../scraper/scheduler.js';

export async function demoRoutes(app: FastifyInstance) {

  app.get('/api/demo/status', async (_request, reply) => {
    return reply.send({ demoMode: isDemoMode() });
  });

  app.post('/api/demo/toggle', async (request, reply) => {
    const body = request.body as { enabled?: boolean } | null;
    const enabled = body?.enabled ?? !isDemoMode();

    if (enabled && !isDemoMode()) {
      // Switch to demo database
      const { db, sqlite } = swapToDemo();
      seedDemoData(db, sqlite);
      stopScheduler();
      request.log.info('Demo mode enabled');
    } else if (!enabled && isDemoMode()) {
      // Switch back to real database
      swapToReal();
      startScheduler();
      request.log.info('Demo mode disabled');
    }

    return reply.send({ success: true, demoMode: isDemoMode() });
  });
}
