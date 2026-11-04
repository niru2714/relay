import { Job, Rider } from '../models/index.js';
import {
  AVAILABILITY,
  JOB_STATUS as S,
  JOB_STATUSES,
  TERMINAL_STATUSES,
  type JobStatus,
} from '../domain/constants.js';
import { severityRank } from '../domain/attention.js';
import { settings } from '../config/settings.js';
import { clock } from '../lib/clock.js';
import { presentJobs } from './jobService.js';

export async function getDashboard() {
  const [grouped, openJobs, riders] = await Promise.all([
    Job.aggregate<{ _id: JobStatus; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Job.find({ status: { $nin: TERMINAL_STATUSES } })
      .sort({ priorityRank: -1, createdAt: 1 })
      .limit(500),
    Rider.find(),
  ]);
  const byStatus = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  for (const row of grouped) byStatus[row._id] = row.count;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const presented = await presentJobs(openJobs);
  const needsAttention = presented
    .filter((j) => j.attention.length > 0)
    .sort(
      (a, b) =>
        severityRank(a.attention) - severityRank(b.attention) || b.priorityRank - a.priorityRank,
    );
  const totalCapacity = riders.reduce((sum, r) => sum + r.capacity, 0);
  const committed = riders.reduce((sum, r) => sum + r.activeLoad + r.reservedLoad, 0);

  return {
    generatedAt: clock.now(),
    totals: {
      received: total,
      awaitingAssignment: byStatus[S.NEW] + byStatus[S.READY_FOR_ASSIGNMENT],
      awaitingConfirmation: byStatus[S.AWAITING_CONFIRMATION],
      inProgress: byStatus[S.ACCEPTED] + byStatus[S.PICKED_UP],
      manualQueue: byStatus[S.MANUAL_QUEUE],
      completed: byStatus[S.DELIVERED],
      cancelled: byStatus[S.CANCELLED],
    },
    inProgressBreakdown: { accepted: byStatus[S.ACCEPTED], pickedUp: byStatus[S.PICKED_UP] },
    byStatus,
    attention: {
      total: needsAttention.length,
      critical: needsAttention.filter((j) => j.attention.some((a) => a.severity === 'critical'))
        .length,
      items: needsAttention.slice(0, 12),
    },
    riders: {
      total: riders.length,
      available: riders.filter((r) => r.availability === AVAILABILITY.AVAILABLE).length,
      onBreak: riders.filter((r) => r.availability === AVAILABILITY.ON_BREAK).length,
      offline: riders.filter((r) => r.availability === AVAILABILITY.OFFLINE).length,
      capacityUtilization: totalCapacity ? Math.round((committed / totalCapacity) * 100) : 0,
    },
    config: {
      ...settings.get(),
      simulatedClock: clock.isSimulated(),
      clockOffsetMinutes: clock.offsetMinutes(),
    },
  };
}
