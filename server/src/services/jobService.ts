import crypto from 'node:crypto';
import type { FilterQuery } from 'mongoose';
import { Job, Rider, Assignment, type IJob, type JobDoc } from '../models/index.js';
import type { AttentionItem } from '../domain/types.js';
import type { Actor, CreateJobInput, Id, ListJobsQuery } from './types.js';
import {
  ASSIGNMENT_STATUS as A,
  EVENT_TYPE as E,
  JOB_STATUS as S,
  PRIORITY_RANK,
  TERMINAL_STATUSES,
} from '../domain/constants.js';
import { computeAttention, severityRank } from '../domain/attention.js';
import { clock } from '../lib/clock.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { systemActor } from '../lib/actors.js';
import { recordEvent } from './eventService.js';
import { transitionJob } from './jobTransitions.js';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type JobDTO = Omit<IJob, 'assignedRiderId'> & {
  id: string;
  assignedRiderId: string | null;
  assignedRider: { id: string; name: string } | null;
  attention: AttentionItem[];
};

export async function presentJobs(jobs: JobDoc[]): Promise<JobDTO[]> {
  const riderIds = [
    ...new Set(jobs.map((j) => j.assignedRiderId && String(j.assignedRiderId)).filter(Boolean)),
  ];
  const riders = riderIds.length ? await Rider.find({ _id: { $in: riderIds } }).select('name') : [];
  const names = new Map(riders.map((r) => [String(r._id), r.name]));
  const now = clock.now();
  return jobs.map((doc) => {
    const job = doc.toJSON() as unknown as IJob & { id: string };
    return {
      ...job,
      assignedRiderId: job.assignedRiderId ? String(job.assignedRiderId) : null,
      assignedRider: job.assignedRiderId
        ? {
            id: String(job.assignedRiderId),
            name: names.get(String(job.assignedRiderId)) ?? 'Unknown',
          }
        : null,
      attention: computeAttention(job, { now }),
    };
  });
}

export async function presentJob(doc: JobDoc): Promise<JobDTO> {
  return (await presentJobs([doc]))[0];
}

const hashPayload = (payload: unknown) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

export async function createJob(
  input: CreateJobInput,
  actor: Actor,
): Promise<{ job: JobDoc; duplicate: boolean }> {
  const now = clock.now();
  if (input.deadline && input.deadline <= now) {
    throw unprocessable('DEADLINE_IN_PAST', 'The delivery deadline must be in the future', {
      deadline: input.deadline,
    });
  }
  const orderId = input.orderId.trim().toUpperCase();
  const payloadHash = hashPayload({
    pickupZone: input.pickupZone,
    deliveryZone: input.deliveryZone,
    load: input.load,
    priority: input.priority,
    deadline: input.deadline ? input.deadline.toISOString() : null,
    customerName: input.customerName ?? '',
    notes: input.notes ?? '',
  });
  let job: JobDoc;
  try {
    job = await Job.create({
      orderId,
      payloadHash,
      customerName: input.customerName,
      notes: input.notes,
      pickupZone: input.pickupZone,
      deliveryZone: input.deliveryZone,
      load: input.load,
      priority: input.priority,
      priorityRank: PRIORITY_RANK[input.priority],
      deadline: input.deadline ?? null,
      status: S.NEW,
      createdBy: actor.name,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    if ((err as { code?: number })?.code !== 11000) throw err;
    const existing = await Job.findOne({ orderId });
    if (existing && existing.payloadHash === payloadHash) return { job: existing, duplicate: true };
    throw conflict(
      'DUPLICATE_ORDER_CONFLICT',
      `Order ${orderId} already exists with different details`,
      { existingJobId: existing && String(existing._id) },
    );
  }
  await recordEvent({
    jobId: job._id,
    type: E.JOB_CREATED,
    actor,
    toStatus: S.NEW,
    message: `Job ${orderId} created: ${job.pickupZone} → ${job.deliveryZone}, ${job.load} units, ${job.priority}`,
    details: {
      orderId,
      pickupZone: job.pickupZone,
      deliveryZone: job.deliveryZone,
      load: job.load,
      priority: job.priority,
      deadline: job.deadline,
    },
  });
  const ready = await transitionJob(job._id, { from: [S.NEW], to: S.READY_FOR_ASSIGNMENT });
  if (ready) {
    await recordEvent({
      jobId: job._id,
      type: E.JOB_READY,
      actor: systemActor(),
      fromStatus: S.NEW,
      toStatus: S.READY_FOR_ASSIGNMENT,
      message: 'Intake checks passed - ready for dispatch',
    });
  }
  return { job: ready ?? job, duplicate: false };
}
export async function getJob(id: Id) {
  const job = await Job.findById(id);
  if (!job) throw notFound('Job', id);
  const presented = await presentJob(job);
  const current = job.currentAssignmentId
    ? await Assignment.findById(job.currentAssignmentId)
    : null;
  return { ...presented, currentAssignment: current ? current.toJSON() : null };
}
export async function listJobs({
  q,
  status,
  zone,
  pickupZone,
  deliveryZone,
  priority,
  riderId,
  attention,
  sort = 'newest',
  page = 1,
  limit = 25,
}: ListJobsQuery) {
  const filter: FilterQuery<IJob> = {};
  if (q) filter.orderId = { $regex: escapeRegex(q.trim()), $options: 'i' };
  if (status?.length) filter.status = { $in: status };
  if (zone) filter.$or = [{ pickupZone: zone }, { deliveryZone: zone }];
  if (pickupZone) filter.pickupZone = pickupZone;
  if (deliveryZone) filter.deliveryZone = deliveryZone;
  if (priority) filter.priority = priority;
  if (riderId) filter.assignedRiderId = riderId;
  const sortSpec = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    priority: { priorityRank: -1, createdAt: 1 },
    deadline: { deadline: 1, createdAt: 1 },
  }[sort] as Record<string, 1 | -1>;
  if (attention) {
    const open = await Job.find({
      ...filter,
      status: { $nin: TERMINAL_STATUSES, ...(filter.status ?? {}) },
    })
      .sort(sortSpec)
      .limit(1000);
    const presented = (await presentJobs(open)).filter((j) => j.attention.length > 0);
    presented.sort((a, b) => severityRank(a.attention) - severityRank(b.attention));
    const start = (page - 1) * limit;
    return {
      data: presented.slice(start, start + limit),
      meta: { page, limit, total: presented.length },
    };
  }

  const [jobs, total] = await Promise.all([
    Job.find(filter)
      .sort(sortSpec)
      .skip((page - 1) * limit)
      .limit(limit),
    Job.countDocuments(filter),
  ]);
  return { data: await presentJobs(jobs), meta: { page, limit, total } };
}
export const countFailedAttempts = (jobId: Id) =>
  Assignment.countDocuments({ jobId, status: { $in: [A.REJECTED, A.EXPIRED, A.WITHDRAWN] } });
