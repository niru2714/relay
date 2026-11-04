import { MongoMemoryServer } from 'mongodb-memory-server';

let server: MongoMemoryServer | undefined;

export async function setup() {
  server = await MongoMemoryServer.create();
  process.env.TEST_MONGO_BASE = server.getUri('placeholder').replace(/placeholder.*$/, '');
}

export async function teardown() {
  await server?.stop();
}
