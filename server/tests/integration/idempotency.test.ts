import { describe, expect, it } from 'vitest';
import {
  assignedJob,
  dispatcher,
  eventTypes,
  newRider,
  reload,
  useWorld,
} from '../helpers/world.js';
import { Job } from '../../src/models/index.js';
import type { CreateJobInput } from '../../src/services/types.js';
import { createJob } from '../../src/services/jobService.js';
import * as assignments from '../../src/services/assignmentService.js';
import * as delivery from '../../src/services/deliveryService.js';
import * as integrity from '../../src/services/integrityService.js';

useWorld();

const payload = (o: Partial<CreateJobInput> = {}): CreateJobInput => ({
  orderId: 'ORD-5001',
  pickupZone: 'T. Nagar',
  deliveryZone: 'Anna Nagar',
  load: 4,
  priority: 'HIGH',
  ...o,
});

describe('7 · a duplicate job submission does not create a second job', () => {
  it('a repeated identical request returns the original job', async () => {
    const first = await createJob(payload(), dispatcher);
    const second = await createJob(payload(), dispatcher);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(String(second.job._id)).toBe(String(first.job._id));
    expect(await Job.countDocuments()).toBe(1);
    expect((await eventTypes(first.job._id)).filter((t) => t === 'JOB_CREATED')).toHaveLength(1);
  });

  it('is race-safe: 25 simultaneous identical submissions create exactly one job', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => createJob(payload({ orderId: 'ORD-RACE' }), dispatcher)),
    );
    expect(await Job.countDocuments({ orderId: 'ORD-RACE' })).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => String(r.job._id))).size).toBe(1);
  });

  it('the order reference is case-insensitive', async () => {
    await createJob(payload({ orderId: 'ord-77' }), dispatcher);
    const again = await createJob(payload({ orderId: 'ORD-77' }), dispatcher);
    expect(again.duplicate).toBe(true);
    expect(await Job.countDocuments()).toBe(1);
  });

  it('reusing a reference with different details is a conflict, not a silent overwrite', async () => {
    const original = await createJob(payload(), dispatcher);
    await expect(createJob(payload({ load: 99 }), dispatcher)).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_ORDER_CONFLICT',
      details: { existingJobId: String(original.job._id) },
    });
    expect((await reload.job(original.job._id)).load).toBe(4);
  });

  it('rejects a deadline in the past', async () => {
    await expect(
      createJob(
        payload({ orderId: 'ORD-OLD', deadline: new Date(Date.now() - 60_000) }),
        dispatcher,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'DEADLINE_IN_PAST' });
    expect(await Job.countDocuments()).toBe(0);
  });
});

describe('retries of every write are safe', () => {
  it('assigning the same rider twice returns the existing assignment and reserves once', async () => {
    const { rider, job, assignment } = await assignedJob({ jobOverrides: { load: 6 } });
    const retry = await assignments.assign({
      jobId: job._id,
      riderId: rider.id,
      actor: dispatcher,
    });
    expect(retry.replay).toBe(true);
    expect(String(retry.assignment._id)).toBe(String(assignment._id));
    expect(await reload.assignmentsOf(job._id)).toHaveLength(1);
    expect(await reload.rider(rider.id)).toMatchObject({ reservedLoad: 6, pendingJobs: 1 });
  });

  it('accept / pickup / deliver / cancel retried do not double-apply capacity changes', async () => {
    const { rider, job, assignment, riderAsActor } = await assignedJob({
      jobOverrides: { load: 5 },
    });

    const a1 = await assignments.accept({ assignmentId: assignment._id, actor: riderAsActor });
    const a2 = await assignments.accept({ assignmentId: assignment._id, actor: riderAsActor });
    expect([a1.replay, a2.replay]).toEqual([false, true]);
    expect(await reload.rider(rider.id)).toMatchObject({
      activeLoad: 5,
      activeJobs: 1,
      reservedLoad: 0,
    });

    expect((await delivery.pickUp({ jobId: job._id, actor: riderAsActor })).replay).toBe(false);
    expect((await delivery.pickUp({ jobId: job._id, actor: riderAsActor })).replay).toBe(true);

    expect((await delivery.deliver({ jobId: job._id, actor: riderAsActor })).replay).toBe(false);
    expect((await delivery.deliver({ jobId: job._id, actor: riderAsActor })).replay).toBe(true);
    expect(await reload.rider(rider.id)).toMatchObject({
      activeLoad: 0,
      activeJobs: 0,
      completedCount: 1,
    });

    const events = await eventTypes(job._id);
    expect(events.filter((t) => t === 'DELIVERED')).toHaveLength(1);
    expect(events.filter((t) => t === 'ASSIGNMENT_ACCEPTED')).toHaveLength(1);
    expect((await integrity.check()).ok).toBe(true);
  });

  it('cancelling twice releases capacity once', async () => {
    const { rider, job } = await assignedJob({ jobOverrides: { load: 5 } });
    await delivery.cancel({ jobId: job._id, actor: dispatcher, reason: 'Duplicate order' });
    const again = await delivery.cancel({
      jobId: job._id,
      actor: dispatcher,
      reason: 'Duplicate order',
    });
    expect(again.replay).toBe(true);
    expect(await reload.rider(rider.id)).toMatchObject({ reservedLoad: 0, pendingJobs: 0 });
    expect((await eventTypes(job._id)).filter((t) => t === 'JOB_CANCELLED')).toHaveLength(1);
    expect((await integrity.check()).ok).toBe(true);
    expect(await newRider()).toBeDefined();
  });
});
