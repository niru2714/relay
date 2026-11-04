import { Job, type AssignmentDoc, type JobDoc } from '../models/index.js';
import type { Recommendation } from './types.js';
import type { Actor, CreateJobInput, Id } from './types.js';
import { EVENT_TYPE as E, JOB_STATUS as S, type JobStatus } from '../domain/constants.js';
import { settings } from '../config/settings.js';
import { clock } from '../lib/clock.js';
import { systemActor } from '../lib/actors.js';
import { AppError, notFound } from '../lib/errors.js';
import { invalidTransition } from '../domain/jobStateMachine.js';
import { recordEvent } from './eventService.js';
import { recommendForJob } from './recommendationService.js';
import * as assignments from './assignmentService.js';
import { createJob } from './jobService.js';

export interface DispatchOutcome {
  assigned: boolean;
  reason?: string;
  recommendation: Recommendation;
  job?: JobDoc;
  assignment?: AssignmentDoc | null;
  replay?: boolean;
}

export async function evaluateReadyJob(
  jobId: Id,
  { autoAssign = false, actor = systemActor() }: { autoAssign?: boolean; actor?: Actor } = {},
): Promise<DispatchOutcome> {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job', jobId);
  if (!([S.READY_FOR_ASSIGNMENT, S.MANUAL_QUEUE] as JobStatus[]).includes(job.status)) {
    throw invalidTransition(
      job.status,
      S.AWAITING_CONFIRMATION,
      'Only unassigned jobs can be dispatched.',
    );
  }
  const recommendation = await recommendForJob(job);
  if (!recommendation.hasEligibleRider) {
    if (job.status === S.READY_FOR_ASSIGNMENT) {
      const flagged = await Job.findOneAndUpdate(
        {
          _id: job._id,
          status: S.READY_FOR_ASSIGNMENT,
          'flags.noEligibleRiderSince': { $exists: false },
        },
        { $set: { 'flags.noEligibleRiderSince': clock.now(), updatedAt: clock.now() } },
      );
      if (flagged) {
        await recordEvent({
          jobId: job._id,
          type: E.NO_ELIGIBLE_RIDER,
          actor,
          message:
            'No eligible rider is available - job stays unassigned and is flagged for a dispatcher',
          details: {
            checked: recommendation.ineligible.length,
            reasons: recommendation.ineligible.map((r) => ({
              rider: r.riderName,
              why: r.reasons.map((x) => x.code),
            })),
          },
        });
      }
    }
    return { assigned: false, reason: 'NO_ELIGIBLE_RIDER', recommendation };
  }
  if (job.flags?.noEligibleRiderSince) {
    await Job.updateOne(
      { _id: job._id, status: S.READY_FOR_ASSIGNMENT },
      { $unset: { 'flags.noEligibleRiderSince': '' } },
    );
  }
  if (!autoAssign) return { assigned: false, reason: 'AWAITING_DISPATCHER', recommendation };

  try {
    const result = await assignments.assign({
      jobId: job._id,
      riderId: recommendation.topRiderId!,
      actor,
    });
    return { assigned: true, ...result, recommendation };
  } catch (err) {
    if (err instanceof AppError && err.status === 409)
      return { assigned: false, reason: err.code, recommendation };
    throw err;
  }
}
export const autoAssign = (jobId: Id, actor: Actor) =>
  evaluateReadyJob(jobId, { autoAssign: true, actor });
export async function submitJob(
  input: CreateJobInput,
  actor: Actor,
): Promise<{
  job: JobDoc;
  duplicate: boolean;
  dispatch?: { assigned: boolean; reason?: string } | null;
}> {
  const created = await createJob(input, actor);
  if (created.duplicate) return created;
  const outcome = await evaluateReadyJob(created.job._id, {
    autoAssign: settings.get().autoDispatch,
  }).catch(() => null);
  const fresh = await Job.findById(created.job._id);
  return {
    job: fresh ?? created.job,
    duplicate: false,
    dispatch: outcome && { assigned: outcome.assigned, reason: outcome.reason },
  };
}
export async function dispatchPending({
  autoAssign: auto = settings.get().autoDispatch,
  limit = 50,
}: { autoAssign?: boolean; limit?: number } = {}) {
  const pending = await Job.find({ status: S.READY_FOR_ASSIGNMENT })
    .sort({ priorityRank: -1, deadline: 1, createdAt: 1 })
    .limit(limit)
    .select('_id');
  let assigned = 0;
  let flagged = 0;
  for (const { _id } of pending) {
    const outcome = await evaluateReadyJob(_id, { autoAssign: auto }).catch(() => null);
    if (outcome?.assigned) assigned += 1;
    if (outcome?.reason === 'NO_ELIGIBLE_RIDER') flagged += 1;
  }
  return { evaluated: pending.length, assigned, flagged };
}
