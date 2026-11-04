import mongoose, { type Types } from 'mongoose';
import {
  Job,
  Rider,
  Assignment,
  type IAssignment,
  type JobDoc,
  type AssignmentDoc,
} from '../models/index.js';
import {
  ACTOR_TYPE,
  type AssignmentSource,
  type AssignmentStatus,
  type EventType,
  type JobStatus,
  type ManualQueueReason,
  ASSIGNMENT_STATUS as A,
  ACTIVE_ASSIGNMENT_STATUSES,
  EVENT_TYPE as E,
  JOB_STATUS as S,
  MANUAL_QUEUE_REASON as REASON,
} from '../domain/constants.js';
import { invalidTransition } from '../domain/jobStateMachine.js';
import { settings } from '../config/settings.js';
import { clock } from '../lib/clock.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { systemActor } from '../lib/actors.js';
import { recordEvent } from './eventService.js';
import { recommendForJob } from './recommendationService.js';
import * as capacity from './riderCapacity.js';
import { explainLostRace, transitionJob } from './jobTransitions.js';
import type { Actor, Id, Vetted } from './types.js';
import type { FilterQuery } from 'mongoose';

const { ObjectId } = mongoose.Types;
const sameId = (a: unknown, b: unknown) => String(a) === String(b);

async function loadJob(jobId: Id) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job', jobId);
  return job;
}
async function vetRider({
  job,
  riderId,
  actor,
  overrideReason,
}: {
  job: JobDoc;
  riderId: Id;
  actor: Actor;
  overrideReason?: string;
}): Promise<Vetted> {
  const recommendation = await recommendForJob(job);
  const candidate = recommendation.candidates.find((c) => sameId(c.riderId, riderId));
  if (!candidate) {
    const rider = await Rider.findById(riderId).select('name');
    if (!rider) throw notFound('Rider', riderId);
    const verdict = recommendation.ineligible.find((i) => sameId(i.riderId, riderId));
    throw unprocessable(
      'RIDER_NOT_ELIGIBLE',
      `${rider.name} cannot take this job: ${verdict?.reasons.map((r) => r.message).join('; ')}`,
      {
        riderId: String(riderId),
        reasons: verdict?.reasons ?? [],
      },
    );
  }
  const top = recommendation.candidates[0];
  const isOverride = candidate.rank !== 1;
  if (isOverride && actor.type === ACTOR_TYPE.DISPATCHER && !overrideReason?.trim()) {
    throw unprocessable(
      'OVERRIDE_REASON_REQUIRED',
      `${candidate.riderName} is not the top recommendation (${top.riderName} is). Provide an override reason.`,
      {
        recommended: { riderId: top.riderId, riderName: top.riderName, score: top.score },
        chosen: { riderId: candidate.riderId, rank: candidate.rank },
      },
    );
  }
  return { candidate, top, isOverride, candidateCount: recommendation.candidates.length };
}
function buildAssignment({
  id,
  job,
  riderId,
  attemptNo,
  actor,
  source,
  now,
  vet,
  overrideReason,
  supersedes,
}: {
  id: Types.ObjectId;
  job: JobDoc;
  riderId: Id;
  attemptNo: number;
  actor: Actor;
  source: AssignmentSource;
  now: Date;
  vet: Vetted;
  overrideReason?: string;
  supersedes?: Id;
}) {
  return {
    _id: id,
    jobId: job._id,
    riderId,
    attemptNo,
    status: A.PENDING,
    active: true,
    load: job.load,
    source,
    assignedBy: actor,
    overrideReason: overrideReason?.trim() || undefined,
    supersedes,
    recommendation: {
      rank: vet.candidate.rank,
      score: vet.candidate.score,
      topRiderId: vet.top.riderId,
      topRiderName: vet.top.riderName,
      topScore: vet.top.score,
      candidateCount: vet.candidateCount,
    },
    assignedAt: now,
    expiresAt: new Date(now.getTime() + settings.timeoutMs()),
  };
}
async function abandonBrokenAssignment({
  jobId,
  assignmentId,
  riderId,
  load,
  actor,
}: {
  jobId: Id;
  assignmentId: Id;
  riderId: Id;
  load: number;
  actor: Actor;
}) {
  await capacity.releaseReserved(riderId, load);
  const job = await transitionJob(jobId, {
    from: [S.AWAITING_CONFIRMATION],
    to: S.MANUAL_QUEUE,
    filter: { currentAssignmentId: assignmentId },
    set: {
      manualQueue: {
        reason: REASON.ORPHANED_ASSIGNMENT,
        detail: 'Assignment could not be recorded',
        enteredAt: clock.now(),
      },
    },
    unset: ['currentAssignmentId', 'assignedRiderId', 'assignmentExpiresAt', 'assignedAt'],
  });
  if (job) {
    await recordEvent({
      jobId,
      type: E.MOVED_TO_MANUAL_QUEUE,
      actor,
      fromStatus: S.AWAITING_CONFIRMATION,
      toStatus: S.MANUAL_QUEUE,
      message: 'Assignment could not be recorded; job returned to the manual queue',
    });
  }
}

async function recordAssigned({
  job,
  assignment,
  vet,
  riderName,
  actor,
  isReassignment,
  reason,
  previous,
}: {
  job: JobDoc;
  assignment: AssignmentDoc;
  vet: Vetted;
  riderName: string;
  actor: Actor;
  isReassignment: boolean;
  reason?: string;
  previous: { status: JobStatus; riderName?: string; riderId?: Id; assignmentId?: Id };
}) {
  const base = { jobId: job._id, riderId: assignment.riderId, assignmentId: assignment._id, actor };
  const timeoutMinutes =
    Math.round(
      ((assignment.expiresAt.getTime() - assignment.assignedAt.getTime()) / 60_000) * 100,
    ) / 100;
  await recordEvent({
    ...base,
    type: isReassignment ? E.RIDER_REASSIGNED : E.RIDER_ASSIGNED,
    fromStatus: previous.status,
    toStatus: S.AWAITING_CONFIRMATION,
    message: isReassignment
      ? `Reassigned from ${previous.riderName ?? 'previous rider'} to ${riderName}`
      : `Assigned to ${riderName} (recommendation #${vet.candidate.rank}, score ${vet.candidate.score})`,
    details: {
      attemptNo: assignment.attemptNo,
      source: assignment.source,
      riderName,
      rank: vet.candidate.rank,
      score: vet.candidate.score,
      topPick: { riderId: vet.top.riderId, riderName: vet.top.riderName, score: vet.top.score },
      explanation: vet.candidate.explanation,
      capacityReserved: assignment.load,
      expiresAt: assignment.expiresAt,
      confirmationWindowMinutes: timeoutMinutes,
      ...(isReassignment
        ? { previousAssignmentId: previous.assignmentId, previousRiderId: previous.riderId, reason }
        : {}),
    },
  });
  if (vet.isOverride) {
    await recordEvent({
      ...base,
      type: E.MANUAL_OVERRIDE,
      message: `Override: chose ${riderName} (#${vet.candidate.rank}) instead of ${vet.top.riderName} (#1)`,
      details: {
        reason: assignment.overrideReason,
        chosen: {
          riderId: String(assignment.riderId),
          riderName,
          rank: vet.candidate.rank,
          score: vet.candidate.score,
        },
        recommended: {
          riderId: vet.top.riderId,
          riderName: vet.top.riderName,
          score: vet.top.score,
        },
      },
    });
  }
}
export async function assign({
  jobId,
  riderId,
  actor,
  overrideReason,
}: {
  jobId: Id;
  riderId: Id;
  actor: Actor;
  overrideReason?: string;
}) {
  const job = await loadJob(jobId);
  if (job.status === S.AWAITING_CONFIRMATION && sameId(job.assignedRiderId, riderId)) {
    const existing = await Assignment.findById(job.currentAssignmentId);
    if (!existing)
      throw conflict(
        'ASSIGNMENT_RECORD_MISSING',
        'The job points at an assignment that no longer exists; the maintenance sweep will repair it',
      );
    return { job, assignment: existing, replay: true };
  }
  if (!([S.READY_FOR_ASSIGNMENT, S.MANUAL_QUEUE] as JobStatus[]).includes(job.status)) {
    const hint = ([S.AWAITING_CONFIRMATION, S.ACCEPTED] as JobStatus[]).includes(job.status)
      ? 'This job already has a rider - use reassign to replace them.'
      : undefined;
    throw invalidTransition(job.status, S.AWAITING_CONFIRMATION, hint);
  }
  const vet = await vetRider({ job, riderId, actor, overrideReason });
  const reserved = await capacity.reserve(riderId, job);
  if (!reserved) {
    throw conflict(
      'RIDER_CAPACITY_CHANGED',
      'Rider no longer has the capacity for this job - their workload changed just now',
      { riderId: String(riderId) },
    );
  }
  const assignmentId = new ObjectId();
  const now = clock.now();
  const previousStatus = job.status;
  const expiresAt = new Date(now.getTime() + settings.timeoutMs());
  const claimed = await transitionJob(job._id, {
    from: [previousStatus],
    to: S.AWAITING_CONFIRMATION,
    filter: { currentAssignmentId: null },
    set: {
      currentAssignmentId: assignmentId,
      assignedRiderId: riderId,
      assignedAt: now,
      assignmentExpiresAt: expiresAt,
    },
    unset: ['manualQueue', 'flags'],
    inc: { attemptCount: 1 },
  });
  if (!claimed) {
    await capacity.releaseReserved(riderId, job.load);
    throw await explainLostRace(
      job._id,
      S.AWAITING_CONFIRMATION,
      'Another dispatcher or an automatic process changed this job first. Refresh and review.',
    );
  }

  const source =
    actor.type === ACTOR_TYPE.SYSTEM ? 'AUTO' : vet.isOverride ? 'OVERRIDE' : 'RECOMMENDED';
  let assignment;
  try {
    assignment = await Assignment.create(
      buildAssignment({
        id: assignmentId,
        job,
        riderId,
        attemptNo: claimed.attemptCount,
        actor,
        source,
        now,
        vet,
        overrideReason,
      }),
    );
  } catch (err) {
    await abandonBrokenAssignment({ jobId: job._id, assignmentId, riderId, load: job.load, actor });
    if ((err as { code?: number })?.code === 11000)
      throw conflict('ASSIGNMENT_CONFLICT', 'The job already has an open assignment');
    throw err;
  }
  await recordAssigned({
    job: claimed,
    assignment,
    vet,
    riderName: reserved.name,
    actor,
    isReassignment: false,
    previous: { status: previousStatus },
  });
  return { job: claimed, assignment, replay: false };
}
export async function reassign({
  jobId,
  riderId,
  actor,
  reason,
  expectedAssignmentId,
}: {
  jobId: Id;
  riderId: Id;
  actor: Actor;
  reason: string;
  expectedAssignmentId?: Id;
}) {
  const job = await loadJob(jobId);
  if (!([S.AWAITING_CONFIRMATION, S.ACCEPTED] as JobStatus[]).includes(job.status)) {
    throw invalidTransition(
      job.status,
      S.AWAITING_CONFIRMATION,
      'Only jobs awaiting confirmation or accepted (not picked up) can be reassigned. Use assign for unassigned jobs.',
    );
  }
  if (expectedAssignmentId && !sameId(expectedAssignmentId, job.currentAssignmentId)) {
    throw conflict(
      'STALE_ASSIGNMENT',
      'This job was reassigned or changed since you loaded it. Refresh and review.',
      { currentAssignmentId: String(job.currentAssignmentId) },
    );
  }
  if (sameId(job.assignedRiderId, riderId)) {
    throw conflict('SAME_RIDER', 'That rider is already assigned to this job');
  }
  const vet = await vetRider({ job, riderId, actor, overrideReason: reason });
  const oldAssignmentId = job.currentAssignmentId;
  const oldRider = await Rider.findById(job.assignedRiderId).select('name');
  const reserved = await capacity.reserve(riderId, job);
  if (!reserved) {
    throw conflict(
      'RIDER_CAPACITY_CHANGED',
      'Rider no longer has the capacity for this job - their workload changed just now',
      { riderId: String(riderId) },
    );
  }
  const assignmentId = new ObjectId();
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + settings.timeoutMs());
  const claimed = await transitionJob(job._id, {
    from: [job.status],
    to: S.AWAITING_CONFIRMATION,
    filter: { currentAssignmentId: oldAssignmentId },
    set: {
      currentAssignmentId: assignmentId,
      assignedRiderId: riderId,
      assignedAt: now,
      assignmentExpiresAt: expiresAt,
    },
    inc: { attemptCount: 1 },
  });
  if (!claimed) {
    await capacity.releaseReserved(riderId, job.load);
    throw await explainLostRace(
      job._id,
      S.AWAITING_CONFIRMATION,
      'The assignment changed while you were reassigning (rider answered, it timed out, or someone else acted). Refresh and review.',
    );
  }
  const old = await Assignment.findOneAndUpdate(
    { _id: oldAssignmentId, status: { $in: ACTIVE_ASSIGNMENT_STATUSES } },
    {
      $set: {
        status: A.REASSIGNED,
        active: false,
        closedAt: now,
        closedBy: actor,
        closeReason: reason?.trim(),
      },
    },
    { returnDocument: 'before' },
  );
  if (old) await capacity.releaseFor(old.status, old.riderId, old.load);

  let assignment;
  try {
    assignment = await Assignment.create(
      buildAssignment({
        id: assignmentId,
        job,
        riderId,
        attemptNo: claimed.attemptCount,
        actor,
        source: 'REASSIGNMENT',
        now,
        vet,
        overrideReason: reason,
        supersedes: oldAssignmentId,
      }),
    );
  } catch (err) {
    await abandonBrokenAssignment({ jobId: job._id, assignmentId, riderId, load: job.load, actor });
    throw err;
  }
  await recordAssigned({
    job: claimed,
    assignment,
    vet: { ...vet, isOverride: false },
    riderName: reserved.name,
    actor,
    isReassignment: true,
    reason,
    previous: {
      status: job.status,
      riderName: oldRider?.name,
      riderId: job.assignedRiderId,
      assignmentId: oldAssignmentId,
    },
  });
  return { job: claimed, assignment, replay: false };
}

async function failAssignment({
  assignmentId,
  fromStatuses,
  toStatus,
  filter = {},
  reason,
  detail,
  actor,
  eventType,
  extra = {},
}: {
  assignmentId: Id;
  fromStatuses: AssignmentStatus[];
  toStatus: AssignmentStatus;
  filter?: FilterQuery<IAssignment>;
  reason: ManualQueueReason;
  detail: string;
  actor: Actor;
  eventType: EventType;
  extra?: Record<string, unknown>;
}) {
  const now = clock.now();
  const prev = await Assignment.findOneAndUpdate(
    { _id: assignmentId, status: { $in: fromStatuses }, ...filter },
    {
      $set: {
        status: toStatus,
        active: false,
        respondedAt: now,
        closedAt: now,
        closedBy: actor,
        closeReason: detail,
      },
    },
    { returnDocument: 'before' },
  );
  if (!prev) return null;
  await capacity.releaseFor(prev.status, prev.riderId, prev.load);
  const job = await transitionJob(prev.jobId, {
    from: [S.AWAITING_CONFIRMATION, S.ACCEPTED],
    to: S.MANUAL_QUEUE,
    filter: { currentAssignmentId: prev._id },
    set: {
      manualQueue: {
        reason,
        detail,
        enteredAt: now,
        previousRiderId: prev.riderId,
        previousAssignmentId: prev._id,
      },
    },
    unset: ['currentAssignmentId', 'assignedRiderId', 'assignmentExpiresAt', 'assignedAt'],
  });
  const rider = await Rider.findById(prev.riderId).select('name');
  const fromStatus = job
    ? prev.status === A.ACCEPTED
      ? S.ACCEPTED
      : S.AWAITING_CONFIRMATION
    : null;
  await recordEvent({
    jobId: prev.jobId,
    type: eventType,
    actor,
    riderId: prev.riderId,
    assignmentId: prev._id,
    message: `${rider?.name ?? 'Rider'}: ${detail}`,
    details: {
      attemptNo: prev.attemptNo,
      assignmentStatus: toStatus,
      riderName: rider?.name,
      capacityReleased: {
        units: prev.load,
        from: prev.status === A.ACCEPTED ? 'active' : 'reserved',
      },
      expiresAt: prev.expiresAt,
      ...extra,
    },
  });
  if (job) {
    await recordEvent({
      jobId: prev.jobId,
      type: E.MOVED_TO_MANUAL_QUEUE,
      actor: systemActor(),
      riderId: prev.riderId,
      assignmentId: prev._id,
      fromStatus,
      toStatus: S.MANUAL_QUEUE,
      message: `Moved to the manual queue: ${detail}`,
      details: { reason, detail, previousAssignmentId: String(prev._id) },
    });
  }
  prev.status = toStatus;
  return { assignment: prev, job };
}
export function expire(assignmentId: Id) {
  const now = clock.now();
  return failAssignment({
    assignmentId,
    fromStatuses: [A.PENDING],
    toStatus: A.EXPIRED,
    filter: { expiresAt: { $lte: now } },
    reason: REASON.ASSIGNMENT_TIMEOUT,
    detail: 'did not confirm within the response window',
    actor: systemActor('RELAY timeout sweeper'),
    eventType: E.ASSIGNMENT_EXPIRED,
  });
}
function assertRiderMayAct(assignment: AssignmentDoc, actor: Actor) {
  if (actor.type === ACTOR_TYPE.RIDER && !sameId(actor.id, assignment.riderId)) {
    throw forbidden('NOT_ASSIGNED_RIDER', 'Only the assigned rider can respond to this assignment');
  }
}
async function loadAssignment(id: Id) {
  const assignment = await Assignment.findById(id);
  if (!assignment) throw notFound('Assignment', id);
  return assignment;
}
export async function accept({ assignmentId, actor }: { assignmentId: Id; actor: Actor }) {
  const existing = await loadAssignment(assignmentId);
  assertRiderMayAct(existing, actor);
  const now = clock.now();
  const won = await Assignment.findOneAndUpdate(
    { _id: assignmentId, status: A.PENDING, expiresAt: { $gt: now } },
    { $set: { status: A.ACCEPTED, respondedAt: now } },
    { returnDocument: 'after' },
  );
  if (!won) {
    const current = await loadAssignment(assignmentId);
    if (current.status === A.ACCEPTED) {
      return { assignment: current, job: await loadJob(current.jobId), replay: true };
    }
    if (current.status === A.PENDING && current.expiresAt <= now) {
      await expire(assignmentId);
      throw conflict(
        'ASSIGNMENT_EXPIRED',
        'The confirmation window has passed. The job was moved to the manual queue.',
        { expiresAt: current.expiresAt },
      );
    }
    throw conflict('ASSIGNMENT_NOT_PENDING', `This assignment is already ${current.status}`, {
      status: current.status,
    });
  }
  await capacity.confirm(won.riderId, won.load);
  const job = await transitionJob(won.jobId, {
    from: [S.AWAITING_CONFIRMATION],
    to: S.ACCEPTED,
    filter: { currentAssignmentId: won._id },
    unset: ['assignmentExpiresAt'],
  });
  const rider = await Rider.findById(won.riderId).select('name');
  await recordEvent({
    jobId: won.jobId,
    type: E.ASSIGNMENT_ACCEPTED,
    actor,
    riderId: won.riderId,
    assignmentId: won._id,
    fromStatus: S.AWAITING_CONFIRMATION,
    toStatus: job ? S.ACCEPTED : null,
    message: `${rider?.name ?? 'Rider'} confirmed the assignment`,
    details: {
      attemptNo: won.attemptNo,
      respondedWithinMinutes:
        Math.round(((now.getTime() - won.assignedAt.getTime()) / 60_000) * 10) / 10,
      capacityCommitted: won.load,
    },
  });
  return { assignment: won, job: job ?? (await loadJob(won.jobId)), replay: false };
}
export async function reject({
  assignmentId,
  actor,
  reason,
}: {
  assignmentId: Id;
  actor: Actor;
  reason?: string;
}) {
  const existing = await loadAssignment(assignmentId);
  assertRiderMayAct(existing, actor);
  const detail = reason?.trim()
    ? `rejected the assignment - ${reason.trim()}`
    : 'rejected the assignment';
  const result = await failAssignment({
    assignmentId,
    fromStatuses: [A.PENDING],
    toStatus: A.REJECTED,
    reason: REASON.RIDER_REJECTED,
    detail,
    actor,
    eventType: E.ASSIGNMENT_REJECTED,
    extra: { riderReason: reason?.trim() || null },
  });
  if (!result) {
    const current = await loadAssignment(assignmentId);
    if (current.status === A.REJECTED)
      return { assignment: current, job: await loadJob(current.jobId), replay: true };
    throw conflict('ASSIGNMENT_NOT_PENDING', `This assignment is already ${current.status}`, {
      status: current.status,
    });
  }
  return { ...result, replay: false };
}
export async function withdraw({
  assignmentId,
  actor,
  reason,
}: {
  assignmentId: Id;
  actor: Actor;
  reason?: string;
}) {
  const existing = await loadAssignment(assignmentId);
  assertRiderMayAct(existing, actor);
  const detail = reason?.trim()
    ? `withdrew after accepting - ${reason.trim()}`
    : 'withdrew after accepting';
  const result = await failAssignment({
    assignmentId,
    fromStatuses: [A.ACCEPTED],
    toStatus: A.WITHDRAWN,
    reason: REASON.RIDER_WITHDREW,
    detail,
    actor,
    eventType: E.ASSIGNMENT_WITHDRAWN,
    extra: { riderReason: reason?.trim() || null },
  });
  if (!result) {
    const current = await loadAssignment(assignmentId);
    throw conflict(
      'ASSIGNMENT_NOT_ACCEPTED',
      `Only an accepted assignment (before pickup) can be withdrawn; this one is ${current.status}`,
      { status: current.status },
    );
  }
  return { ...result, replay: false };
}
export async function listAssignmentsForJob(jobId: Id) {
  const [assignments, riders] = await Promise.all([
    Assignment.find({ jobId }).sort({ attemptNo: 1 }),
    Rider.find().select('name'),
  ]);
  const names = new Map(riders.map((r) => [String(r._id), r.name]));
  return assignments.map((a) => ({
    ...a.toJSON(),
    riderId: String(a.riderId),
    riderName: names.get(String(a.riderId)) ?? 'Unknown',
  }));
}
