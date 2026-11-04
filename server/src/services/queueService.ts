import { Job, Assignment } from '../models/index.js';
import type { Actor, Id } from './types.js';
import {
  EVENT_TYPE as E,
  JOB_STATUS as S,
  MANUAL_QUEUE_REASON as REASON,
  type JobStatus,
} from '../domain/constants.js';
import { clock } from '../lib/clock.js';
import { notFound } from '../lib/errors.js';
import { recordEvent } from './eventService.js';
import { explainLostRace, transitionJob } from './jobTransitions.js';
import { presentJob, presentJobs } from './jobService.js';
import { listEvents } from './eventService.js';
import { listAssignmentsForJob } from './assignmentService.js';
import { recommendForJob } from './recommendationService.js';

export async function escalate({
  jobId,
  actor,
  reason,
}: {
  jobId: Id;
  actor: Actor;
  reason: string;
}) {
  const now = clock.now();
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job', jobId);

  const updated = await transitionJob(jobId, {
    from: [S.READY_FOR_ASSIGNMENT],
    to: S.MANUAL_QUEUE,
    set: { manualQueue: { reason: REASON.DISPATCHER_ESCALATION, detail: reason, enteredAt: now } },
    unset: ['flags'],
  });
  if (!updated)
    throw await explainLostRace(jobId, S.MANUAL_QUEUE, 'Only unassigned jobs can be escalated.');

  await recordEvent({
    jobId,
    type: E.MOVED_TO_MANUAL_QUEUE,
    actor,
    fromStatus: S.READY_FOR_ASSIGNMENT,
    toStatus: S.MANUAL_QUEUE,
    message: `Escalated to the manual queue - ${reason}`,
    details: { reason: REASON.DISPATCHER_ESCALATION, detail: reason },
  });
  return { job: updated };
}

export async function requeue({ jobId, actor, note }: { jobId: Id; actor: Actor; note?: string }) {
  const updated = await transitionJob(jobId, {
    from: [S.MANUAL_QUEUE],
    to: S.READY_FOR_ASSIGNMENT,
    unset: ['manualQueue'],
  });
  if (!updated)
    throw await explainLostRace(
      jobId,
      S.READY_FOR_ASSIGNMENT,
      'Only manual-queue jobs can be requeued.',
    );

  await recordEvent({
    jobId,
    type: E.REQUEUED,
    actor,
    fromStatus: S.MANUAL_QUEUE,
    toStatus: S.READY_FOR_ASSIGNMENT,
    message: note ? `Returned to the dispatch pool - ${note}` : 'Returned to the dispatch pool',
  });
  return { job: updated };
}

export async function listManualQueue() {
  const jobs = await Job.find({ status: S.MANUAL_QUEUE }).sort({
    priorityRank: -1,
    'manualQueue.enteredAt': 1,
  });
  const failed = await Assignment.aggregate([
    {
      $match: {
        jobId: { $in: jobs.map((j) => j._id) },
        status: { $in: ['REJECTED', 'EXPIRED', 'WITHDRAWN'] },
      },
    },
    { $group: { _id: '$jobId', failedAttempts: { $sum: 1 } } },
  ]);
  const counts = new Map(failed.map((f) => [String(f._id), f.failedAttempts]));
  const presented = await presentJobs(jobs);
  return presented.map((job) => ({ ...job, failedAttempts: counts.get(job.id) ?? 0 }));
}

export async function investigate(jobId: Id) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job', jobId);
  const [presented, events, assignments, recommendation] = await Promise.all([
    presentJob(job),
    listEvents(job._id),
    listAssignmentsForJob(job._id),
    ([S.READY_FOR_ASSIGNMENT, S.MANUAL_QUEUE] as JobStatus[]).includes(job.status)
      ? recommendForJob(job)
      : null,
  ]);
  return { job: presented, events, assignments, recommendation };
}
