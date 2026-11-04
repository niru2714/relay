import { describe, expect, it } from 'vitest';
import {
  assignedJob,
  dispatcher,
  eventTypes,
  newJob,
  newRider,
  reload,
  riderActor,
  useWorld,
} from '../helpers/world.js';
import { recommendForJob } from '../../src/services/recommendationService.js';
import * as assignments from '../../src/services/assignmentService.js';
import * as delivery from '../../src/services/deliveryService.js';
import * as queue from '../../src/services/queueService.js';
import { evaluateReadyJob } from '../../src/services/dispatchService.js';
import { updateRider } from '../../src/services/riderService.js';
import { computeAttention } from '../../src/domain/attention.js';
import * as integrity from '../../src/services/integrityService.js';

useWorld();

describe('1 · a job is assigned to an eligible rider', () => {
  it('recommends the best rider, assigns, reserves capacity and records the story', async () => {
    const near = await newRider({ name: 'Near', currentZone: 'T. Nagar' });
    await newRider({ name: 'Far', currentZone: 'Anna Nagar' });
    const job = await newJob({ load: 5 });

    const rec = await recommendForJob(job);
    expect(rec.candidates).toHaveLength(2);
    expect(rec.topRiderId).toBe(near.id);

    const { job: assigned, assignment } = await assignments.assign({
      jobId: job._id,
      riderId: rec.topRiderId!,
      actor: dispatcher,
    });

    expect(assigned.status).toBe('AWAITING_CONFIRMATION');
    expect(String(assigned.assignedRiderId)).toBe(near.id);
    expect(assignment).toMatchObject({
      status: 'PENDING',
      active: true,
      load: 5,
      source: 'RECOMMENDED',
    });
    expect(assignment.recommendation).toMatchObject({ rank: 1, topRiderName: 'Near' });
    expect(assignment.expiresAt.getTime() - assignment.assignedAt.getTime()).toBe(120 * 60_000);

    const rider = await reload.rider(near.id);
    expect(rider).toMatchObject({ reservedLoad: 5, pendingJobs: 1, activeLoad: 0, activeJobs: 0 });
    expect(await eventTypes(job._id)).toEqual(['JOB_CREATED', 'JOB_READY', 'RIDER_ASSIGNED']);
    expect((await integrity.check()).ok).toBe(true);
  });
});

describe('2 · unavailable or under-capacity riders are not recommended', () => {
  it('excludes them with reasons, and refuses to assign them', async () => {
    const good = await newRider({ name: 'Good' });
    const offline = await newRider({ name: 'Offline', availability: 'OFFLINE' });
    const onBreak = await newRider({ name: 'OnBreak', availability: 'ON_BREAK' });
    const small = await newRider({ name: 'Small', capacity: 4 });
    const wrongZone = await newRider({
      name: 'WrongZone',
      zones: ['Ambattur', 'Porur'],
      currentZone: 'Ambattur',
    });
    const full = await newRider({ name: 'Full', maxConcurrentJobs: 1 });
    const fullJob = await newJob({ load: 2 });
    await assignments.assign({
      jobId: fullJob._id,
      riderId: full.id,
      actor: dispatcher,
      overrideReason: 'fill this rider up',
    });

    const job = await newJob({ load: 5 });
    const rec = await recommendForJob(job);

    expect(rec.candidates.map((c) => c.riderName)).toContain('Good');
    const blocked = Object.fromEntries(
      rec.ineligible.map((i) => [i.riderName, i.reasons.map((r) => r.code)]),
    );
    expect(blocked.Offline).toContain('UNAVAILABLE');
    expect(blocked.OnBreak).toContain('UNAVAILABLE');
    expect(blocked.Small).toContain('INSUFFICIENT_CAPACITY');
    expect(blocked.WrongZone).toEqual(
      expect.arrayContaining(['PICKUP_ZONE_NOT_SERVED', 'DELIVERY_ZONE_NOT_SERVED']),
    );
    expect(blocked.Full).toContain('NO_FREE_SLOT');
    expect(rec.candidates.map((c) => c.riderId)).not.toEqual(
      expect.arrayContaining([offline.id, onBreak.id, small.id, wrongZone.id, full.id]),
    );

    for (const rider of [offline, small, wrongZone, full]) {
      await expect(
        assignments.assign({ jobId: job._id, riderId: rider.id, actor: dispatcher }),
      ).rejects.toMatchObject({ status: 422, code: 'RIDER_NOT_ELIGIBLE' });
    }
    expect((await reload.job(job._id)).status).toBe('READY_FOR_ASSIGNMENT');
    expect((await reload.rider(small.id)).reservedLoad).toBe(0);
    expect(good.id).toBeDefined();
  });

  it("counts a rider's reserved (not yet accepted) load against their capacity", async () => {
    const rider = await newRider({ capacity: 10, maxConcurrentJobs: 5 });
    const a = await newJob({ load: 6 });
    const b = await newJob({ load: 6 });
    await assignments.assign({ jobId: a._id, riderId: rider.id, actor: dispatcher });
    const rec = await recommendForJob(b);
    expect(rec.candidates).toHaveLength(0);
    expect(rec.ineligible[0].reasons[0]).toMatchObject({ code: 'INSUFFICIENT_CAPACITY' });
  });
});

describe('3 · a job with no eligible rider stays available for manual intervention', () => {
  it('remains READY, is flagged once, surfaces as needing attention, and can still be dispatched later', async () => {
    await newRider({ availability: 'OFFLINE' });
    const job = await newJob();

    const first = await evaluateReadyJob(job._id);
    const second = await evaluateReadyJob(job._id);
    expect(first).toMatchObject({ assigned: false, reason: 'NO_ELIGIBLE_RIDER' });
    expect(second.reason).toBe('NO_ELIGIBLE_RIDER');

    const stored = await reload.job(job._id);
    expect(stored.status).toBe('READY_FOR_ASSIGNMENT');
    expect(stored.currentAssignmentId).toBeUndefined();
    expect(computeAttention(stored.toJSON(), { now: new Date() }).map((i) => i.code)).toContain(
      'NO_ELIGIBLE_RIDER',
    );
    expect((await eventTypes(job._id)).filter((t) => t === 'NO_ELIGIBLE_RIDER')).toHaveLength(1);

    const rider = (await import('../../src/models/index.js')).Rider;
    const [{ id }] = (await rider.find()).map((r) => ({ id: String(r._id) })) as [{ id: string }];
    await updateRider(id, { availability: 'AVAILABLE' });
    const outcome = await evaluateReadyJob(job._id);
    expect(outcome.reason).toBe('AWAITING_DISPATCHER');
    expect((await reload.job(job._id)).flags?.noEligibleRiderSince).toBeUndefined();
    const { job: assigned } = await assignments.assign({
      jobId: job._id,
      riderId: id,
      actor: dispatcher,
    });
    expect(assigned.status).toBe('AWAITING_CONFIRMATION');
  });

  it('can be escalated to the manual queue and assigned from there', async () => {
    const job = await newJob();
    await queue.escalate({
      jobId: job._id,
      actor: dispatcher,
      reason: 'Customer wants a call before dispatch',
    });
    expect((await reload.job(job._id)).status).toBe('MANUAL_QUEUE');
    expect((await queue.listManualQueue()).map((j) => j.id)).toContain(String(job._id));

    const rider = await newRider();
    const { job: assigned } = await assignments.assign({
      jobId: job._id,
      riderId: rider.id,
      actor: dispatcher,
    });
    expect(assigned.status).toBe('AWAITING_CONFIRMATION');
    expect(assigned.manualQueue).toBeUndefined();
  });
});

describe('4 · a confirmed assignment proceeds through the delivery lifecycle', () => {
  it('accept → pickup → deliver, with the capacity ledger and history following along', async () => {
    const { rider, job, assignment, riderAsActor } = await assignedJob({
      jobOverrides: { load: 7, deliveryZone: 'Adyar' },
    });

    const accepted = await assignments.accept({
      assignmentId: assignment._id,
      actor: riderAsActor,
    });
    expect(accepted.job.status).toBe('ACCEPTED');
    expect(await reload.rider(rider.id)).toMatchObject({
      reservedLoad: 0,
      pendingJobs: 0,
      activeLoad: 7,
      activeJobs: 1,
    });

    const picked = await delivery.pickUp({ jobId: job._id, actor: riderAsActor });
    expect(picked.job.status).toBe('PICKED_UP');

    const done = await delivery.deliver({ jobId: job._id, actor: riderAsActor });
    expect(done.job.status).toBe('DELIVERED');
    expect(done.job.currentAssignmentId).toBeUndefined();

    expect(await reload.rider(rider.id)).toMatchObject({
      activeLoad: 0,
      activeJobs: 0,
      reservedLoad: 0,
      completedCount: 1,
      currentZone: 'Adyar',
    });
    expect((await reload.assignment(assignment._id)).status).toBe('COMPLETED');
    expect(await eventTypes(job._id)).toEqual([
      'JOB_CREATED',
      'JOB_READY',
      'RIDER_ASSIGNED',
      'ASSIGNMENT_ACCEPTED',
      'PICKED_UP',
      'DELIVERED',
    ]);
    expect((await integrity.check()).ok).toBe(true);
  });

  it('only the assigned rider may respond or update the delivery', async () => {
    const { assignment, job } = await assignedJob();
    const stranger = riderActor({ id: '64b000000000000000000000', name: 'Stranger' });
    await expect(
      assignments.accept({ assignmentId: assignment._id, actor: stranger }),
    ).rejects.toMatchObject({ status: 403, code: 'NOT_ASSIGNED_RIDER' });
    await expect(delivery.pickUp({ jobId: job._id, actor: stranger })).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('8 · invalid status transitions are refused', () => {
  it('rejects delivering before pickup and picking up before acceptance, leaving state untouched', async () => {
    const { job, assignment, riderAsActor } = await assignedJob();

    await expect(delivery.pickUp({ jobId: job._id, actor: riderAsActor })).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    await assignments.accept({ assignmentId: assignment._id, actor: riderAsActor });
    await expect(delivery.deliver({ jobId: job._id, actor: riderAsActor })).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: expect.stringMatching(/not been picked up/),
    });
    expect((await reload.job(job._id)).status).toBe('ACCEPTED');
  });

  it('a cancelled job cannot be assigned, accepted, picked up or delivered', async () => {
    const { rider, job, assignment, riderAsActor } = await assignedJob();
    await delivery.cancel({
      jobId: job._id,
      actor: dispatcher,
      reason: 'Customer changed their mind',
    });

    expect((await reload.job(job._id)).status).toBe('CANCELLED');
    await expect(
      assignments.accept({ assignmentId: assignment._id, actor: riderAsActor }),
    ).rejects.toMatchObject({ status: 409, code: 'ASSIGNMENT_NOT_PENDING' });
    await expect(delivery.pickUp({ jobId: job._id, actor: dispatcher })).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    await expect(delivery.deliver({ jobId: job._id, actor: dispatcher })).rejects.toMatchObject({
      status: 409,
    });
    await expect(delivery.pickUp({ jobId: job._id, actor: riderAsActor })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      assignments.assign({ jobId: job._id, riderId: rider.id, actor: dispatcher }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await reload.rider(rider.id)).toMatchObject({ reservedLoad: 0, pendingJobs: 0 });
    expect((await reload.assignment(assignment._id)).status).toBe('CANCELLED');
  });

  it('a picked-up delivery cannot be cancelled; a delivered one cannot be changed', async () => {
    const { job, assignment, riderAsActor } = await assignedJob();
    await assignments.accept({ assignmentId: assignment._id, actor: riderAsActor });
    await delivery.pickUp({ jobId: job._id, actor: riderAsActor });
    await expect(
      delivery.cancel({ jobId: job._id, actor: dispatcher, reason: 'Too late' }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/in transit/) });
    await delivery.deliver({ jobId: job._id, actor: riderAsActor });
    await expect(
      delivery.cancel({ jobId: job._id, actor: dispatcher, reason: 'Too late' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      queue.escalate({ jobId: job._id, actor: dispatcher, reason: 'Nope' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('cancelling an accepted job releases the rider’s active capacity', async () => {
    const { rider, job, assignment, riderAsActor } = await assignedJob({
      jobOverrides: { load: 9 },
    });
    await assignments.accept({ assignmentId: assignment._id, actor: riderAsActor });
    expect((await reload.rider(rider.id)).activeLoad).toBe(9);
    await delivery.cancel({ jobId: job._id, actor: dispatcher, reason: 'Merchant closed' });
    expect(await reload.rider(rider.id)).toMatchObject({ activeLoad: 0, activeJobs: 0 });
    expect((await integrity.check()).ok).toBe(true);
  });
});

describe('rejection behaviour', () => {
  it('moves the job to the manual queue, releases capacity, keeps the attempt, and excludes the rider next time', async () => {
    const { rider, job, assignment, riderAsActor } = await assignedJob();
    const other = await newRider({ name: 'Backup', currentZone: 'Anna Nagar' });

    const result = await assignments.reject({
      assignmentId: assignment._id,
      actor: riderAsActor,
      reason: 'Vehicle broke down',
    });
    expect(result.job!.status).toBe('MANUAL_QUEUE');
    expect(result.job!.manualQueue).toMatchObject({ reason: 'RIDER_REJECTED' });
    expect(await reload.rider(rider.id)).toMatchObject({ reservedLoad: 0, pendingJobs: 0 });
    expect((await reload.assignment(assignment._id)).status).toBe('REJECTED');
    expect(await eventTypes(job._id)).toEqual(
      expect.arrayContaining(['ASSIGNMENT_REJECTED', 'MOVED_TO_MANUAL_QUEUE']),
    );

    const rec = await recommendForJob(await reload.job(job._id));
    expect(rec.candidates.map((c) => c.riderId)).toEqual([other.id]);
    expect(
      rec.ineligible.find((i) => i.riderId === rider.id)!.reasons.map((r) => r.code),
    ).toContain('PREVIOUSLY_REJECTED');
  });

  it('a rider who accepted and then withdraws sends the job back to the queue', async () => {
    const { rider, job, assignment, riderAsActor } = await assignedJob({
      jobOverrides: { load: 6 },
    });
    await assignments.accept({ assignmentId: assignment._id, actor: riderAsActor });
    const result = await assignments.withdraw({
      assignmentId: assignment._id,
      actor: riderAsActor,
      reason: 'Family emergency',
    });
    expect(result.job!.status).toBe('MANUAL_QUEUE');
    expect(result.job!.manualQueue!.reason).toBe('RIDER_WITHDREW');
    expect(await reload.rider(rider.id)).toMatchObject({ activeLoad: 0, activeJobs: 0 });
    expect((await integrity.check()).ok).toBe(true);
    expect(job._id).toBeDefined();
  });
});

describe('overrides and reassignment', () => {
  it('requires a reason to pick a rider other than the top recommendation, and records it', async () => {
    const top = await newRider({ name: 'Top', currentZone: 'T. Nagar' });
    const second = await newRider({ name: 'Second', currentZone: 'Anna Nagar' });
    const job = await newJob();

    await expect(
      assignments.assign({ jobId: job._id, riderId: second.id, actor: dispatcher }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'OVERRIDE_REASON_REQUIRED',
      details: { recommended: { riderId: top.id } },
    });
    expect((await reload.job(job._id)).status).toBe('READY_FOR_ASSIGNMENT');

    const { assignment } = await assignments.assign({
      jobId: job._id,
      riderId: second.id,
      actor: dispatcher,
      overrideReason: 'Customer asked for Second by name',
    });
    expect(assignment).toMatchObject({
      source: 'OVERRIDE',
      overrideReason: 'Customer asked for Second by name',
    });
    const events = await reload.events(job._id);
    const override = events.find((e) => e.type === 'MANUAL_OVERRIDE');
    expect(override!.details).toMatchObject({
      reason: 'Customer asked for Second by name',
      recommended: { riderName: 'Top' },
      chosen: { riderName: 'Second', rank: 2 },
    });
    expect(override!.actor!.name).toBe('Test Dispatcher');
  });

  it('reassigns a pending job: old attempt kept as REASSIGNED, capacity moves to the new rider', async () => {
    const { rider: first, job, assignment } = await assignedJob({ jobOverrides: { load: 4 } });
    const second = await newRider({ name: 'Second', currentZone: 'Anna Nagar' });

    const result = await assignments.reassign({
      jobId: job._id,
      riderId: second.id,
      actor: dispatcher,
      reason: 'First rider stuck in traffic',
      expectedAssignmentId: assignment._id,
    });
    expect(result.job.status).toBe('AWAITING_CONFIRMATION');
    expect(String(result.job.assignedRiderId)).toBe(second.id);
    expect(result.assignment).toMatchObject({
      attemptNo: 2,
      source: 'REASSIGNMENT',
      status: 'PENDING',
    });

    expect((await reload.assignment(assignment._id)).status).toBe('REASSIGNED');
    expect(await reload.rider(first.id)).toMatchObject({ reservedLoad: 0, pendingJobs: 0 });
    expect(await reload.rider(second.id)).toMatchObject({ reservedLoad: 4, pendingJobs: 1 });
    expect(await eventTypes(job._id)).toContain('RIDER_REASSIGNED');
    expect((await integrity.check()).ok).toBe(true);
  });

  it('refuses a stale reassignment (someone else changed the job first) and the same rider again', async () => {
    const { rider, job, assignment } = await assignedJob();
    const second = await newRider({ name: 'Second' });
    await expect(
      assignments.reassign({
        jobId: job._id,
        riderId: second.id,
        actor: dispatcher,
        reason: 'because',
        expectedAssignmentId: '64b000000000000000000000',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'STALE_ASSIGNMENT' });
    await expect(
      assignments.reassign({
        jobId: job._id,
        riderId: rider.id,
        actor: dispatcher,
        reason: 'because',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'SAME_RIDER' });
    expect(String((await reload.job(job._id)).currentAssignmentId)).toBe(String(assignment._id));
    expect(await reload.rider(second.id)).toMatchObject({ reservedLoad: 0 });
  });

  it('reassigning an accepted job frees the old rider’s active load', async () => {
    const {
      rider: first,
      job,
      assignment,
      riderAsActor,
    } = await assignedJob({ jobOverrides: { load: 8 } });
    await assignments.accept({ assignmentId: assignment._id, actor: riderAsActor });
    const second = await newRider({ name: 'Second', currentZone: 'Anna Nagar' });
    await assignments.reassign({
      jobId: job._id,
      riderId: second.id,
      actor: dispatcher,
      reason: 'First rider’s van failed',
    });

    expect((await reload.job(job._id)).status).toBe('AWAITING_CONFIRMATION');
    expect(await reload.rider(first.id)).toMatchObject({ activeLoad: 0, activeJobs: 0 });
    expect(await reload.rider(second.id)).toMatchObject({ reservedLoad: 8, pendingJobs: 1 });
    expect((await integrity.check()).ok).toBe(true);
  });
});

describe('manual queue investigation', () => {
  it('returns the job, its full history, every attempt and fresh recommendations in one call', async () => {
    const { job, assignment, riderAsActor } = await assignedJob();
    await newRider({ name: 'Backup' });
    await assignments.reject({
      assignmentId: assignment._id,
      actor: riderAsActor,
      reason: 'Cannot make it',
    });

    const view = await queue.investigate(job._id);
    expect(view.job.status).toBe('MANUAL_QUEUE');
    expect(view.job.attention[0].code).toBe('IN_MANUAL_QUEUE');
    expect(view.assignments).toHaveLength(1);
    expect(view.assignments[0]).toMatchObject({
      status: 'REJECTED',
      riderName: expect.any(String),
    });
    expect(view.events.map((e) => e.type)).toContain('ASSIGNMENT_REJECTED');
    expect(view.recommendation!.candidates.length).toBeGreaterThan(0);
  });

  it('a manual-queue job can be returned to the dispatch pool', async () => {
    const job = await newJob();
    await queue.escalate({ jobId: job._id, actor: dispatcher, reason: 'Hold' });
    const { job: back } = await queue.requeue({
      jobId: job._id,
      actor: dispatcher,
      note: 'Resolved',
    });
    expect(back.status).toBe('READY_FOR_ASSIGNMENT');
    expect(back.manualQueue).toBeUndefined();
  });
});
