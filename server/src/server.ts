import { env } from './config/env.js';
import { connectDb, disconnectDb, startMemoryDb } from './db/connect.js';
import { createApp } from './app.js';
import { Job } from './models/index.js';
import { seedDemoData } from './services/seedService.js';
import { startSweeper } from './services/timeoutService.js';

async function main() {
  let memory = null;
  let uri = env.mongoUri;
  if (env.useMemoryDb) {
    console.log(
      '[db] MONGODB_URI not set - starting an in-memory MongoDB (data resets on restart)',
    );
    memory = await startMemoryDb();
    uri = memory.uri;
  }
  await connectDb(uri);
  console.log(`[db] connected (${env.useMemoryDb ? 'in-memory' : 'external'})`);

  if (env.seedOnStart && (await Job.estimatedDocumentCount()) === 0) {
    const summary = await seedDemoData();
    console.log(`[seed] loaded ${summary.riders} riders and ${summary.jobs} jobs with history`);
  }

  const stopSweeper = startSweeper({ intervalMs: env.sweepIntervalMs });
  const server = createApp().listen(env.port, () => {
    console.log(
      `[api] RELAY listening on http://localhost:${env.port}  (assignment timeout ${env.assignmentTimeoutMinutes} min)`,
    );
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[api] ${signal} received - shutting down`);
    stopSweeper();
    server.close();
    await disconnectDb();
    await memory?.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
