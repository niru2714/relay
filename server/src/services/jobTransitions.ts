import type { UpdateQuery, FilterQuery } from 'mongoose';
import { Job, type IJob } from '../models/index.js';
import type { JobStatus } from '../domain/constants.js';
import type { Id } from './types.js';
import { assertTransition, invalidTransition } from '../domain/jobStateMachine.js';
import { clock } from '../lib/clock.js';
import { notFound, conflict } from '../lib/errors.js';

export interface TransitionSpec {
  from: JobStatus[];
  to: JobStatus;
  filter?: FilterQuery<IJob>;
  set?: Record<string, unknown>;
  unset?: string[];
  inc?: Record<string, number>;
}
export function transitionJob(
  jobId: Id,
  { from, to, filter = {}, set = {}, unset = [], inc = {} }: TransitionSpec,
) {
  from.forEach((status) => assertTransition(status, to));
  const update: UpdateQuery<IJob> = { $set: { ...set, status: to, updatedAt: clock.now() } };
  if (unset.length) update.$unset = Object.fromEntries(unset.map((path) => [path, '']));
  if (Object.keys(inc).length) update.$inc = inc;
  return Job.findOneAndUpdate({ _id: jobId, status: { $in: from }, ...filter }, update, {
    returnDocument: 'after',
  });
}
export async function explainLostRace(jobId: Id, attemptedTo: JobStatus, hint?: string) {
  const job = await Job.findById(jobId).select('status');
  if (!job) return notFound('Job', jobId);
  if (job.status === attemptedTo && attemptedTo !== 'AWAITING_CONFIRMATION') {
    return conflict('JOB_STATE_CHANGED', `Job is already ${job.status}`, { current: job.status });
  }
  const base = invalidTransition(job.status, attemptedTo, hint);
  return conflict(
    'JOB_STATE_CHANGED',
    `Job changed while processing - it is now ${job.status}. ${hint ?? ''}`.trim(),
    {
      ...(base.details as object),
      current: job.status,
    },
  );
}
