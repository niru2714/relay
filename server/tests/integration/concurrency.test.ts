import { describe, expect, it } from 'vitest';
import {
  assignedJob,
  dispatcher,
  newJob,
  newRider,
  otherDispatcher,
  reload,
  useWorld,
} from '../helpers/world.js';
import { Assignment } from '../../src/models/index.js';
import * as assignments from '../../src/services/assignmentService.js';
import * as delivery from '../../src/services/deliveryService.js';
import { processExpired } from '../../src/services/timeoutService.js';
import { clock } from '../../src/lib/clock.js';
import * as integrity from '../../src/services/integrityService.js';

useWorld();

type Settled = PromiseSettledResult<unknown>[];
const settle = (promises: Promise<unknown>[]): Promise<Settled> => Promise.allSettled(promises);
const won = (results: Settled) => results.filter((r) => r.status === 'fulfilled');
const lost = (results: Settled) =>
  results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason as { status: number; code: string });

describe('8 · conflicting assignment attempts are handled correctly', () => {
  it('two dispatchers assigning the same job to different riders: exactly one wins', async () => {
    for (let round = 0; round < 8; round += 1) {
      const a = await newRider({ name: `A${round}`, currentZone: 'T. Nagar' });
      const b = await newRider({ name: `B${round}`, currentZone: 'T. Nagar' });
      const job = await newJob({ load: 5 });

      const results = await settle([
        assignments.assign({
          jobId: job._id,
          riderId: a.id,
          actor: dispatcher,
          overrideReason: 'my choice',
        }),
        assignments.assign({
          jobId: job._id,
          riderId: b.id,
          actor: otherDispatcher,
          overrideReason: 'my choice',
        }),
      ]);

      expect(won(results)).toHaveLength(1);
      expect(lost(results)).toHaveLength(1);
      expect(lost(results)[0]).toMatchObject({ status: 409 });

      const open = await Assignment.find({ jobId: job._id, active: true });
      expect(open).toHaveLength(1);
      const [ra, rb] = await Promise.all([reload.rider(a.id), reload.rider(b.id)]);
      expect(ra.reservedLoad + rb.reservedLoad).toBe(5);
      expect(ra.pendingJobs + rb.pendingJobs).toBe(1);
    }
    expect((await integrity.check()).ok).toBe(true);
  });

  it('two dispatchers assigning the same rider to the same job: one assignment, both calls succeed (idempotent)', async () => {
    const rider = await newRider();
    const job = await newJob();
    const results = await settle([
      assignments.assign({ jobId: job._id, riderId: rider.id, actor: dispatcher }),
      assignments.assign({ jobId: job._id, riderId: rider.id, actor: otherDispatcher }),
    ]);
    expect(won(results).length).toBeGreaterThanOrEqual(1);
    expect(await Assignment.countDocuments({ jobId: job._id })).toBe(1);
    expect((await reload.rider(rider.id)).reservedLoad).toBe(5);
  });

  it('a rider can never be over-committed, however many jobs race for them', async () => {
    const rider = await newRider({ capacity: 20, maxConcurrentJobs: 3 });
    const jobs = await Promise.all(Array.from({ length: 8 }, () => newJob({ load: 5 })));

    const results = await settle(
      jobs.map((j) => assignments.assign({ jobId: j._id, riderId: rider.id, actor: dispatcher })),
    );

    expect(won(results)).toHaveLength(3);
    for (const failure of lost(results)) {
      expect(failure.status).toBeGreaterThanOrEqual(409);
      expect(['RIDER_CAPACITY_CHANGED', 'RIDER_NOT_ELIGIBLE']).toContain(failure.code);
    }
    const stored = await reload.rider(rider.id);
    expect(stored.reservedLoad).toBe(15);
    expect(stored.pendingJobs).toBe(3);
    expect(stored.reservedLoad).toBeLessThanOrEqual(stored.capacity);
    expect((await integrity.check()).ok).toBe(true);
  });

  it('capacity limit is enforced by load too, not only by job count', async () => {
    const rider = await newRider({ capacity: 12, maxConcurrentJobs: 10 });
    const jobs = await Promise.all(Array.from({ length: 6 }, () => newJob({ load: 5 })));
    const results = await settle(
      jobs.map((j) => assignments.assign({ jobId: j._id, riderId: rider.id, actor: dispatcher })),
    );
    expect(won(results)).toHaveLength(2);
    expect((await reload.rider(rider.id)).reservedLoad).toBe(10);
  });

  it('the database itself refuses a second open assignment for a job (index backstop)', async () => {
    const { job, assignment } = await assignedJob();
    const clone = { ...assignment.toObject(), _id: undefined };
    delete clone._id;
    await expect(Assignment.create(clone)).rejects.toMatchObject({ code: 11000 });
    expect(await Assignment.countDocuments({ jobId: job._id, active: true })).toBe(1);
  });
});

describe('simultaneous responses to the same assignment', () => {
  it('accept, reject and cancel racing: one consistent outcome, ledger balanced', async () => {
    for (let round = 0; round < 10; round += 1) {
      const { rider, job, assignment, riderAsActor } = await assignedJob({
        jobOverrides: { load: 4 },
      });
      const results = await settle([
        assignments.accept({ assignmentId: assignment._id, actor: riderAsActor }),
        assignments.reject({ assignmentId: assignment._id, actor: riderAsActor, reason: 'cannot' }),
        delivery.cancel({ jobId: job._id, actor: dispatcher, reason: 'customer cancelled' }),
      ]);
      expect(won(results).length).toBeGreaterThanOrEqual(1);

      const finalJob = await reload.job(job._id);
      const finalAssignment = await reload.assignment(assignment._id);
      const stored = await reload.rider(rider.id);

      if (finalJob.status === 'ACCEPTED') {
        expect(finalAssignment.status).toBe('ACCEPTED');
        expect(stored).toMatchObject({
          activeLoad: 4,
          activeJobs: 1,
          reservedLoad: 0,
          pendingJobs: 0,
        });
      } else {
        expect(['MANUAL_QUEUE', 'CANCELLED']).toContain(finalJob.status);
        expect(finalAssignment.active).toBe(false);
        expect(stored).toMatchObject({
          activeLoad: 0,
          activeJobs: 0,
          reservedLoad: 0,
          pendingJobs: 0,
        });
      }
      await reload.rider(rider.id);
    }
    expect((await integrity.check()).ok).toBe(true);
  });

  it('timeout sweeps racing a reassignment never double-release capacity', async () => {
    for (let round = 0; round < 6; round += 1) {
      const { job } = await assignedJob({ jobOverrides: { load: 3 } });
      const second = await newRider({ name: `S${round}`, currentZone: 'Anna Nagar' });
      clock.advanceMinutes(121);
      await settle([
        processExpired(),
        assignments.reassign({
          jobId: job._id,
          riderId: second.id,
          actor: dispatcher,
          reason: 'faster rider',
        }),
        processExpired(),
      ]);
    }
    expect((await integrity.check()).ok).toBe(true);
  });

  it('cancel racing assign leaves either a cancelled job with nothing reserved, or an assigned job - never both', async () => {
    for (let round = 0; round < 8; round += 1) {
      const rider = await newRider({ name: `R${round}` });
      const job = await newJob({ load: 5 });
      await settle([
        assignments.assign({ jobId: job._id, riderId: rider.id, actor: dispatcher }),
        delivery.cancel({ jobId: job._id, actor: otherDispatcher, reason: 'customer cancelled' }),
      ]);
      const finalJob = await reload.job(job._id);
      const stored = await reload.rider(rider.id);
      if (finalJob.status === 'CANCELLED') {
        expect(stored.reservedLoad).toBe(0);
        expect(await Assignment.countDocuments({ jobId: job._id, active: true })).toBe(0);
      } else {
        expect(finalJob.status).toBe('AWAITING_CONFIRMATION');
        expect(stored.reservedLoad).toBe(5);
      }
    }
    expect((await integrity.check()).ok).toBe(true);
  });
});
