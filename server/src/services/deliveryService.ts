import { Job, Assignment, Rider, type JobDoc } from '../models/index.js';
import type { JobStatus } from '../domain/constants.js';
import type { Actor, Id } from './types.js';
import {
  ACTOR_TYPE,
  ASSIGNMENT_STATUS as A,
  ACTIVE_ASSIGNMENT_STATUSES,
  EVENT_TYPE as E,
  JOB_STATUS as S,
} from '../domain/constants.js';
import { clock } from '../lib/clock.js';
import { forbidden, notFound } from '../lib/errors.js';
import { invalidTransition } from '../domain/jobStateMachine.js';
import { recordEvent } from './eventService.js';
import * as capacity from './riderCapacity.js';
import { explainLostRace, transitionJob } from './jobTransitions.js';

async function loadJob(jobId: Id) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job', jobId);
  return job;
}

function assertAssignedRider(job: JobDoc, actor: Actor) {
  if (actor.type === ACTOR_TYPE.RIDER && String(job.assignedRiderId) !== String(actor.id)) {
    throw forbidden('NOT_ASSIGNED_RIDER', 'Only the assigned rider can update this delivery');
  }
}

const HINTS: Partial<Record<JobStatus, Partial<Record<JobStatus, string>>>> = {
  [S.PICKED_UP]: {
    [S.NEW]: 'The job has not been dispatched yet.',
    [S.READY_FOR_ASSIGNMENT]: 'No rider has been assigned yet.',
    [S.AWAITING_CONFIRMATION]: 'The rider has not confirmed the assignment yet.',
    [S.MANUAL_QUEUE]: 'The job is in the manual queue and has no rider.',
    [S.CANCELLED]: 'The job was cancelled.',
    [S.DELIVERED]: 'The job is already delivered.',
  },
  [S.DELIVERED]: {
    [S.ACCEPTED]: 'The delivery has not been picked up yet.',
    [S.CANCELLED]: 'The job was cancelled.',
    [S.AWAITING_CONFIRMATION]: 'The rider has not confirmed the assignment yet.',
    [S.MANUAL_QUEUE]: 'The job is in the manual queue and has no rider.',
    [S.READY_FOR_ASSIGNMENT]: 'No rider has been assigned yet.',
  },
  [S.CANCELLED]: {
    [S.PICKED_UP]: 'The delivery is already in transit and cannot be cancelled.',
    [S.DELIVERED]: 'The job is already delivered.',
  },
};

const rejectTransition = (job: JobDoc, to: JobStatus) =>
  invalidTransition(job.status, to, HINTS[to]?.[job.status]);

export async function pickUp({ jobId, actor }: { jobId: Id; actor: Actor }) {
  const job = await loadJob(jobId);
  assertAssignedRider(job, actor);
  if (job.status === S.PICKED_UP) return { job, replay: true };
  if (job.status !== S.ACCEPTED) throw rejectTransition(job, S.PICKED_UP);

  const now = clock.now();
  const updated = await transitionJob(jobId, {
    from: [S.ACCEPTED],
    to: S.PICKED_UP,
    set: { pickedUpAt: now },
  });
  if (!updated) throw await explainLostRace(jobId, S.PICKED_UP);

  await Rider.updateOne(
    { _id: updated.assignedRiderId },
    { $set: { currentZone: updated.pickupZone, updatedAt: now } },
  );
  await recordEvent({
    jobId,
    type: E.PICKED_UP,
    actor,
    riderId: updated.assignedRiderId,
    assignmentId: updated.currentAssignmentId,
    fromStatus: S.ACCEPTED,
    toStatus: S.PICKED_UP,
    message: `Picked up in ${updated.pickupZone}`,
  });
  return { job: updated, replay: false };
}

export async function deliver({ jobId, actor }: { jobId: Id; actor: Actor }) {
  const job = await loadJob(jobId);
  assertAssignedRider(job, actor);
  if (job.status === S.DELIVERED) return { job, replay: true };
  if (job.status !== S.PICKED_UP) throw rejectTransition(job, S.DELIVERED);

  const now = clock.now();
  const assignmentId = job.currentAssignmentId;
  const updated = await transitionJob(jobId, {
    from: [S.PICKED_UP],
    to: S.DELIVERED,
    filter: { currentAssignmentId: assignmentId },
    set: { deliveredAt: now },
    unset: ['currentAssignmentId', 'assignmentExpiresAt'],
  });
  if (!updated) throw await explainLostRace(jobId, S.DELIVERED);

  const closed = await Assignment.findOneAndUpdate(
    { _id: assignmentId, status: A.ACCEPTED },
    {
      $set: {
        status: A.COMPLETED,
        active: false,
        closedAt: now,
        closedBy: actor,
        closeReason: 'delivered',
      },
    },
    { returnDocument: 'before' },
  );
  if (closed)
    await capacity.releaseActive(closed.riderId, closed.load, {
      delivered: true,
      currentZone: updated.deliveryZone,
    });

  await recordEvent({
    jobId,
    type: E.DELIVERED,
    actor,
    riderId: updated.assignedRiderId,
    assignmentId,
    fromStatus: S.PICKED_UP,
    toStatus: S.DELIVERED,
    message: `Delivered in ${updated.deliveryZone}`,
    details: {
      capacityReleased: closed ? closed.load : 0,
      onTime: updated.deadline ? now <= updated.deadline : null,
    },
  });
  return { job: updated, replay: false };
}

const CANCELLABLE: JobStatus[] = [
  S.NEW,
  S.READY_FOR_ASSIGNMENT,
  S.AWAITING_CONFIRMATION,
  S.ACCEPTED,
  S.MANUAL_QUEUE,
];

export async function cancel({
  jobId,
  actor,
  reason,
}: {
  jobId: Id;
  actor: Actor;
  reason: string;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const job = await loadJob(jobId);
    if (job.status === S.CANCELLED) return { job, replay: true };
    if (!CANCELLABLE.includes(job.status)) throw rejectTransition(job, S.CANCELLED);

    const now = clock.now();
    const assignmentId = job.currentAssignmentId ?? null;
    const updated = await transitionJob(jobId, {
      from: CANCELLABLE,
      to: S.CANCELLED,
      filter: { currentAssignmentId: assignmentId },
      set: { cancellation: { reason, at: now, by: actor.name } },
      unset: [
        'currentAssignmentId',
        'assignedRiderId',
        'assignmentExpiresAt',
        'assignedAt',
        'manualQueue',
        'flags',
      ],
    });
    if (!updated) continue;

    let released = null;
    if (assignmentId) {
      const closed = await Assignment.findOneAndUpdate(
        { _id: assignmentId, status: { $in: ACTIVE_ASSIGNMENT_STATUSES } },
        {
          $set: {
            status: A.CANCELLED,
            active: false,
            closedAt: now,
            closedBy: actor,
            closeReason: `job cancelled - ${reason}`,
          },
        },
        { returnDocument: 'before' },
      );
      if (closed) {
        await capacity.releaseFor(closed.status, closed.riderId, closed.load);
        released = {
          riderId: String(closed.riderId),
          units: closed.load,
          from: closed.status === A.ACCEPTED ? 'active' : 'reserved',
        };
      }
    }
    await recordEvent({
      jobId,
      type: E.JOB_CANCELLED,
      actor,
      fromStatus: job.status,
      toStatus: S.CANCELLED,
      riderId: job.assignedRiderId,
      assignmentId: assignmentId ?? undefined,
      message: `Cancelled - ${reason}`,
      details: { reason, capacityReleased: released },
    });
    return { job: updated, replay: false };
  }
  throw await explainLostRace(jobId, S.CANCELLED, 'The job kept changing; try again.');
}
