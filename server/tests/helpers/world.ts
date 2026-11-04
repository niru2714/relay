import crypto from 'node:crypto';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../../src/db/connect.js';
import { Job, Rider, Assignment, JobEvent } from '../../src/models/index.js';
import { settings } from '../../src/config/settings.js';
import { clock } from '../../src/lib/clock.js';
import { dispatcherActor, riderActor } from '../../src/lib/actors.js';
import { createRider } from '../../src/services/riderService.js';
import { createJob } from '../../src/services/jobService.js';
import * as assignments from '../../src/services/assignmentService.js';
import type { CreateJobInput, CreateRiderInput, Id } from '../../src/services/types.js';

export const dispatcher = dispatcherActor('Test Dispatcher');
export const otherDispatcher = dispatcherActor('Second Dispatcher');
export { riderActor };

export function useWorld() {
  beforeAll(async () => {
    await connectDb(`${process.env.TEST_MONGO_BASE}relay_${crypto.randomBytes(4).toString('hex')}`);
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectDb();
  });
  beforeEach(async () => {
    await Promise.all([
      Job.deleteMany({}),
      Rider.deleteMany({}),
      Assignment.deleteMany({}),
      JobEvent.deleteMany({}),
    ]);
    settings.reset();
    clock.reset();
  });
}

let seq = 0;

export const newRider = (overrides: Partial<CreateRiderInput> = {}) =>
  createRider({
    name: `Rider ${(seq += 1)}`,
    vehicle: 'SCOOTER',
    zones: ['T. Nagar', 'Anna Nagar', 'Adyar'],
    currentZone: 'T. Nagar',
    availability: 'AVAILABLE',
    capacity: 20,
    maxConcurrentJobs: 3,
    ...overrides,
  });

export async function newJob(overrides: Partial<CreateJobInput> = {}) {
  const { job } = await createJob(
    {
      orderId: `T-${(seq += 1)}`,
      pickupZone: 'T. Nagar',
      deliveryZone: 'Anna Nagar',
      load: 5,
      priority: 'NORMAL',
      ...overrides,
    },
    dispatcher,
  );
  return job;
}

const found = <T>(doc: T, what: string): NonNullable<T> => {
  if (doc === null || doc === undefined) throw new Error(`${what} not found`);
  return doc as NonNullable<T>;
};

export const reload = {
  job: async (id: Id) => found(await Job.findById(id), 'job'),
  rider: async (id: Id) => found(await Rider.findById(id), 'rider'),
  assignment: async (id: Id) => found(await Assignment.findById(id), 'assignment'),
  assignmentsOf: (jobId: Id) => Assignment.find({ jobId }).sort({ attemptNo: 1 }),
  events: async (jobId: Id) =>
    (await JobEvent.find({ jobId }).sort({ _id: 1 })).map((e) => e.toJSON()),
};

export const eventTypes = async (jobId: Id) => (await reload.events(jobId)).map((e) => e.type);

export async function assignedJob({
  jobOverrides,
  riderOverrides,
}: { jobOverrides?: Partial<CreateJobInput>; riderOverrides?: Partial<CreateRiderInput> } = {}) {
  const rider = await newRider(riderOverrides);
  const job = await newJob(jobOverrides);
  const { assignment } = await assignments.assign({
    jobId: job._id,
    riderId: rider.id,
    actor: dispatcher,
    overrideReason: 'test setup',
  });
  return { rider, job, assignment, riderAsActor: riderActor(rider) };
}
