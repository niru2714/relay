import mongoose from 'mongoose';
import '../models/index.js';

export async function connectDb(uri: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export async function startMemoryDb(dbName = 'relay') {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const server = await MongoMemoryServer.create();
  return { uri: server.getUri(dbName), stop: () => server.stop() };
}
