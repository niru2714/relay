import { describe, expect, it } from 'vitest';
import {
  assignedJob,
  dispatcher,
  eventTypes,
  newJob,
  newRider,
  reload,
  useWorld,
} from '../helpers/world.js';
import * as assignments from '../../src/services/assignmentService.js';
import {
  processExpired,
  repairOrphans,
  runMaintenance,
} from '../../src/services/timeoutService.js';
import { settings } from '../../src/config/settings.js';
import { clock } from '../../src/lib/clock.js';
import { Job } from '../../src/models/index.js';
import * as integrity from '../../src/services/integrityService.js';

useWorld();

describe('5 · an assignment that exceeds the threshold moves to the Manual Queue', () => {
  it('does nothing before the threshold and moves the job exactly after it (default 2 h)', async () => {
    const { job } = await assignedJob();

    clock.advanceMinutes(119);
    expect(await processExpired()).toMatchObject({ due: 0, expired: 0 });
    expect((await reload.job(job._id)).status).toBe('AWAITING_CONFIRMATION');

    clock.advanceMinutes(2);
    expect(await processExpired()).toMatchObject({ due: 1, expired: 1 });

    const moved = await reload.job(job._id);
    expect(moved.status).toBe('MANUAL_QUEUE');
    expect(moved.manualQueue).toMatchObject({ reason: 'ASSIGNMENT_TIMEOUT' });
    expect(moved.manualQueue!.detail).toMatch(/did not confirm/);
    expect(moved.currentAssignmentId).toBeUndefined();
    expect(moved.assignedRiderId).toBeUndefined();
  });

  it('honours a configurable threshold', async () => {
    settings.update({ assignmentTimeoutMinutes: 1 });
    const { job, assignment } = await assignedJob();
    expect(assignment.expiresAt.getTime() - assignment.assignedAt.getTime()).toBe(60_000);

    clock.advanceMinutes(0.5);
    expect((await processExpired()).expired).toBe(0);
    clock.advanceMinutes(0.6);
    expect((await processExpired()).expired).toBe(1);
    expect((await reload.job(job._id)).status).toBe('MANUAL_QUEUE');
  });

  it('is applied by the maintenance tick as well', async () => {
    const { job } = await assignedJob();
    clock.advanceMinutes(130);
    const result = await runMaintenance();
    expect(result.timeouts.expired).toBe(1);
    expect((await reload.job(job._id)).status).toBe('MANUAL_QUEUE');
  });
});

describe('6 · a timed-out assignment releases capacity and retains its history', () => {
  it('frees the reservation, keeps the EXPIRED attempt, records why, and allows another attempt', async () => {
    const { rider, job, assignment } = await assignedJob({ jobOverrides: { load: 9 } });
    expect(await reload.rider(rider.id)).toMatchObject({ reservedLoad: 9, pendingJobs: 1 });

    clock.advanceMinutes(121);
    await processExpired();

    expect(await reload.rider(rider.id)).toMatchObject({
      reservedLoad: 0,
      pendingJobs: 0,
      activeLoad: 0,
      activeJobs: 0,
    });

    const kept = await reload.assignment(assignment._id);
    expect(kept).toMatchObject({ status: 'EXPIRED', active: false });
    expect(kept.closeReason).toMatch(/did not confirm/);
    expect(kept.closedBy!.name).toMatch(/sweeper/);

    const events = await reload.events(job._id);
    expect(events.map((e) => e.type)).toEqual([
      'JOB_CREATED',
      'JOB_READY',
      'RIDER_ASSIGNED',
      'ASSIGNMENT_EXPIRED',
      'MOVED_TO_MANUAL_QUEUE',
    ]);
    const expired = events.find((e) => e.type === 'ASSIGNMENT_EXPIRED');
    expect(expired!.details).toMatchObject({ capacityReleased: { units: 9, from: 'reserved' } });
    expect((events.at(-1)!.details as { reason: string }).reason).toBe('ASSIGNMENT_TIMEOUT');

    const backup = await newRider({ name: 'Backup' });
    const { assignment: second, job: reassigned } = await assignments.assign({
      jobId: job._id,
      riderId: backup.id,
      actor: dispatcher,
      overrideReason: 'Original rider unresponsive',
    });
    expect(reassigned.status).toBe('AWAITING_CONFIRMATION');
    expect(second.attemptNo).toBe(2);
    expect(await reload.assignmentsOf(job._id)).toHaveLength(2);
    expect((await integrity.check()).ok).toBe(true);
  });

  it('is idempotent: running the sweeper repeatedly records the timeout once', async () => {
    const { job } = await assignedJob();
    clock.advanceMinutes(121);
    await processExpired();
    await processExpired();
    await Promise.all([processExpired(), processExpired(), processExpired()]);
    expect((await eventTypes(job._id)).filter((t) => t === 'ASSIGNMENT_EXPIRED')).toHaveLength(1);
    expect((await integrity.check()).ok).toBe(true);
  });

  it('a late acceptance after the deadline is refused, and the job is moved to the queue immediately', async () => {
    const { rider, job, assignment, riderAsActor } = await assignedJob();
    clock.advanceMinutes(125);
    await expect(
      assignments.accept({ assignmentId: assignment._id, actor: riderAsActor }),
    ).rejects.toMatchObject({ status: 409, code: 'ASSIGNMENT_EXPIRED' });
    expect((await reload.job(job._id)).status).toBe('MANUAL_QUEUE');
    expect(await reload.rider(rider.id)).toMatchObject({ reservedLoad: 0, activeLoad: 0 });
    expect((await reload.assignment(assignment._id)).status).toBe('EXPIRED');
  });

  it('an acceptance just inside the window still wins and the sweeper leaves it alone', async () => {
    const { job, assignment, riderAsActor } = await assignedJob();
    clock.advanceMinutes(119);
    await assignments.accept({ assignmentId: assignment._id, actor: riderAsActor });
    clock.advanceMinutes(10);
    expect((await processExpired()).expired).toBe(0);
    expect((await reload.job(job._id)).status).toBe('ACCEPTED');
  });

  it('a timeout does not touch a job that was reassigned in the meantime', async () => {
    const { job, assignment } = await assignedJob();
    const second = await newRider({ name: 'Second', currentZone: 'Anna Nagar' });
    await assignments.reassign({
      jobId: job._id,
      riderId: second.id,
      actor: dispatcher,
      reason: 'Faster rider found',
    });
    clock.advanceMinutes(121);
    clock.advanceMinutes(0);
    await processExpired();
    expect((await reload.assignment(assignment._id)).status).toBe('REASSIGNED');
  });
});

describe('orphan repair (crash safety)', () => {
  it('moves a job whose assignment record is missing to the manual queue instead of leaving it stuck', async () => {
    const rider = await newRider();
    const job = await newJob();
    await Job.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'AWAITING_CONFIRMATION',
          currentAssignmentId: '64b000000000000000000001',
          assignedRiderId: rider.id,
          updatedAt: clock.now(),
        },
      },
    );
    clock.advanceMinutes(1);
    const result = await repairOrphans();
    expect(result.repaired).toBe(1);
    const fixed = await reload.job(job._id);
    expect(fixed.status).toBe('MANUAL_QUEUE');
    expect(fixed.manualQueue!.reason).toBe('ORPHANED_ASSIGNMENT');
    expect(await eventTypes(job._id)).toContain('MOVED_TO_MANUAL_QUEUE');
  });

  it('leaves healthy pending assignments alone', async () => {
    const { job } = await assignedJob();
    clock.advanceMinutes(5);
    expect((await repairOrphans()).repaired).toBe(0);
    expect((await reload.job(job._id)).status).toBe('AWAITING_CONFIRMATION');
  });
});
