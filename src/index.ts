import { createServer } from './server.js';

const { start, shutdown } = await createServer();

process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });

try {
  await start();
} catch (err) {
  console.error(err);
  process.exit(1);
}
