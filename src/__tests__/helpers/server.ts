import type { FastifyInstance } from 'fastify';
import { type TestDb } from './db.js';

export interface TestServer {
  app: FastifyInstance;
  testDb: TestDb;
  inject: FastifyInstance['inject'];
  close: () => Promise<void>;
}

export async function createTestServer(testDb: TestDb): Promise<TestServer> {
  const { createServer } = await import('../../server.js');
  const { app } = await createServer();
  await app.ready();

  return {
    app,
    testDb,
    inject: app.inject.bind(app),
    close: async () => {
      await app.close();
      testDb.close();
    },
  };
}

export function authHeaders(): Record<string, string> {
  return { authorization: 'Bearer test-token' };
}
