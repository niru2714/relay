import { env } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { seedDemoData } from './services/seedService.js';

if (env.useMemoryDb) {
  console.log(
    'MONGODB_URI is not set: the default in-memory database is seeded automatically when the API starts.',
  );
  process.exit(0);
}
await connectDb(env.mongoUri);
const summary = await seedDemoData({ reset: true });
console.log(`Seeded ${summary.riders} riders and ${summary.jobs} jobs.`);
await disconnectDb();
