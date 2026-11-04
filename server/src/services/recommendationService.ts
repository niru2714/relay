import { Rider, Assignment, type JobDoc } from '../models/index.js';
import type { PriorAttempts } from '../domain/types.js';
import type { Recommendation } from './types.js';
import { ASSIGNMENT_STATUS as A } from '../domain/constants.js';
import { rankRiders } from '../domain/ranking.js';
import { riderToPlain } from './riderService.js';
import { clock } from '../lib/clock.js';

export async function recommendForJob(job: JobDoc): Promise<Recommendation> {
  const [riders, attempts] = await Promise.all([
    Rider.find(),
    Assignment.find({
      jobId: job._id,
      status: { $in: [A.REJECTED, A.EXPIRED, A.WITHDRAWN] },
    }).select('riderId status'),
  ]);
  const priorAttempts: PriorAttempts = {};
  for (const attempt of attempts) {
    const id = String(attempt.riderId);
    const kind = attempt.status === A.EXPIRED ? 'EXPIRED' : 'REJECTED';
    if (priorAttempts[id] !== 'REJECTED') priorAttempts[id] = kind;
  }
  const now = clock.now();
  const ranking = rankRiders(
    {
      pickupZone: job.pickupZone,
      deliveryZone: job.deliveryZone,
      load: job.load,
      priority: job.priority,
      deadline: job.deadline,
    },
    riders.map(riderToPlain),
    { now, priorAttempts },
  );
  return {
    jobId: String(job._id),
    jobStatus: job.status,
    generatedAt: now,
    ...ranking,
    topRiderId: ranking.candidates[0]?.riderId ?? null,
    hasEligibleRider: ranking.candidates.length > 0,
  };
}
