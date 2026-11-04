import { AVAILABILITY, type Priority } from './constants.js';
import { travelMinutes } from './travel.js';
import type {
  EligibilityReason,
  JobRequirements,
  PriorAttempts,
  RankingContext,
  RiderMetrics,
  RiderPlain,
} from './types.js';

type Factor = 'travel' | 'workload' | 'fit' | 'deadline';
export type FactorBreakdown = Record<Factor, { value: number; weight: number; points: number }>;
export interface DeadlineInfo {
  minutesLeft: number;
  slackMinutes: number;
  atRisk: boolean;
}
export interface Score {
  score: number;
  etaMinutes: number;
  travelToPickupMinutes: number;
  breakdown: FactorBreakdown;
  deadline: DeadlineInfo | null;
  reasons: string[];
  warnings: string[];
}
export interface Candidate extends Score {
  rank: number;
  riderId: string;
  riderName: string;
  vehicle: string;
  currentZone: string;
  explanation: string;
  metrics: RiderMetrics;
}
export interface IneligibleRider {
  riderId: string;
  riderName: string;
  vehicle: string;
  reasons: EligibilityReason[];
  metrics: RiderMetrics;
}
export interface Ranking {
  weights: Record<Factor, number>;
  candidates: Candidate[];
  ineligible: IneligibleRider[];
}

export const WEIGHTS: Readonly<Record<Priority, Record<Factor, number>>> = Object.freeze({
  LOW: { travel: 0.35, workload: 0.3, fit: 0.1, deadline: 0.25 },
  NORMAL: { travel: 0.35, workload: 0.3, fit: 0.1, deadline: 0.25 },
  HIGH: { travel: 0.45, workload: 0.2, fit: 0.05, deadline: 0.3 },
  URGENT: { travel: 0.55, workload: 0.1, fit: 0.05, deadline: 0.3 },
});
export const TUNING = Object.freeze({
  travelHorizonMinutes: 45,
  deadlineComfortMinutes: 30,
  handlingMinutes: 5,
  expiredBeforePenalty: 15,
});
const FACTOR_LABEL: Record<Factor, string> = {
  travel: 'closer to pickup',
  workload: 'lighter workload',
  fit: 'better capacity fit',
  deadline: 'more deadline headroom',
};
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const idOf = (r: { id: string }) => String(r.id);
export function riderMetrics(rider: RiderPlain): RiderMetrics {
  const committedLoad = rider.activeLoad + rider.reservedLoad;
  const jobCount = rider.activeJobs + rider.pendingJobs;
  return {
    committedLoad,
    availableCapacity: Math.max(0, rider.capacity - committedLoad),
    jobCount,
    openSlots: Math.max(0, rider.maxConcurrentJobs - jobCount),
    utilization: rider.capacity > 0 ? Math.min(1, committedLoad / rider.capacity) : 1,
  };
}

export function evaluateEligibility(
  rider: RiderPlain,
  job: JobRequirements,
  ctx: { priorAttempts?: PriorAttempts } = {},
) {
  const metrics = riderMetrics(rider);
  const reasons: EligibilityReason[] = [];
  if (rider.availability !== AVAILABILITY.AVAILABLE) {
    reasons.push({
      code: 'UNAVAILABLE',
      message: `Rider is ${rider.availability.toLowerCase().replace('_', ' ')}`,
    });
  }
  const zones = new Set(rider.zones);
  if (!zones.has(job.pickupZone)) {
    reasons.push({
      code: 'PICKUP_ZONE_NOT_SERVED',
      message: `Does not serve pickup zone ${job.pickupZone}`,
    });
  }
  if (!zones.has(job.deliveryZone)) {
    reasons.push({
      code: 'DELIVERY_ZONE_NOT_SERVED',
      message: `Does not serve delivery zone ${job.deliveryZone}`,
    });
  }
  if (metrics.availableCapacity < job.load) {
    reasons.push({
      code: 'INSUFFICIENT_CAPACITY',
      message: `Needs ${job.load} units but only ${metrics.availableCapacity} free`,
    });
  }
  if (metrics.openSlots < 1) {
    reasons.push({
      code: 'NO_FREE_SLOT',
      message: `Already carrying the maximum of ${rider.maxConcurrentJobs} concurrent jobs`,
    });
  }
  if (ctx.priorAttempts?.[idOf(rider)] === 'REJECTED') {
    reasons.push({ code: 'PREVIOUSLY_REJECTED', message: 'Already rejected this job' });
  }
  return { eligible: reasons.length === 0, reasons, metrics };
}
export function scoreRider(
  rider: RiderPlain,
  job: JobRequirements,
  ctx: RankingContext = {},
): Score {
  const now = ctx.now ?? new Date();
  const metrics = riderMetrics(rider);
  const weights = WEIGHTS[job.priority ?? 'NORMAL'];
  const toPickup = travelMinutes(rider.currentZone, job.pickupZone);
  const haul = travelMinutes(job.pickupZone, job.deliveryZone);
  const etaMinutes = toPickup + haul + TUNING.handlingMinutes;
  const values: Record<Factor, number> = {
    travel: clamp01(1 - toPickup / TUNING.travelHorizonMinutes),
    workload: clamp01(1 - metrics.jobCount / Math.max(1, rider.maxConcurrentJobs)),
    fit: clamp01(1 - (metrics.availableCapacity - job.load) / Math.max(1, rider.capacity)),
    deadline: 1,
  };
  let deadline: DeadlineInfo | null = null;
  if (job.deadline) {
    const minutesLeft = (new Date(job.deadline).getTime() - now.getTime()) / 60_000;
    const slack = minutesLeft - etaMinutes;
    values.deadline = slack < 0 ? 0 : clamp01(slack / TUNING.deadlineComfortMinutes);
    deadline = {
      minutesLeft: Math.round(minutesLeft),
      slackMinutes: Math.round(slack),
      atRisk: slack < 0,
    };
  }
  const breakdown = {} as FactorBreakdown;
  let score = 0;
  for (const factor of Object.keys(weights) as Factor[]) {
    const points = values[factor] * weights[factor] * 100;
    breakdown[factor] = {
      value: round1(values[factor]),
      weight: weights[factor],
      points: round1(points),
    };
    score += points;
  }
  const warnings: string[] = [];
  if (ctx.priorAttempts?.[idOf(rider)] === 'EXPIRED') {
    score -= TUNING.expiredBeforePenalty;
    warnings.push(
      `Did not respond to an earlier assignment of this job (−${TUNING.expiredBeforePenalty} pts)`,
    );
  }
  if (deadline?.atRisk) {
    warnings.push(
      `Projected ETA ${etaMinutes} min misses the deadline by ${Math.abs(deadline.slackMinutes)} min`,
    );
  }

  const reasons = [
    `${toPickup} min from pickup (${rider.currentZone} → ${job.pickupZone}), ETA ${etaMinutes} min`,
    `${metrics.jobCount} of ${rider.maxConcurrentJobs} job slots in use`,
    `${metrics.availableCapacity} of ${rider.capacity} capacity units free (needs ${job.load})`,
  ];
  if (deadline && !deadline.atRisk)
    reasons.push(`Arrives ${deadline.slackMinutes} min before the deadline`);
  return {
    score: Math.max(0, round1(score)),
    etaMinutes,
    travelToPickupMinutes: toPickup,
    breakdown,
    deadline,
    reasons,
    warnings,
  };
}
type Scored = { score: number; breakdown: FactorBreakdown; warnings: string[] };
function explainGap(higher: Scored, lower: Scored) {
  let best: { factor: Factor; delta: number } = { factor: 'travel', delta: 0 };
  for (const factor of Object.keys(higher.breakdown) as Factor[]) {
    const delta = higher.breakdown[factor].points - lower.breakdown[factor].points;
    if (Math.abs(delta) > Math.abs(best.delta)) best = { factor, delta };
  }
  const gap = round1(higher.score - lower.score);
  const penaltyNote =
    higher.warnings.length !== lower.warnings.length && gap > 0 && best.delta <= 0
      ? ' (after penalties)'
      : '';
  if (gap === 0)
    return { gap, text: 'tied on score; decided by fewer open jobs, then shorter ETA' };
  const factor =
    best.delta >= 0 ? FACTOR_LABEL[best.factor] : `${FACTOR_LABEL[best.factor]} (offset elsewhere)`;
  return { gap, text: `${gap} pts higher, mainly ${factor}${penaltyNote}` };
}
export function rankRiders(
  job: JobRequirements,
  riders: RiderPlain[],
  ctx: RankingContext = {},
): Ranking {
  const evaluated = riders.map((rider) => ({ rider, ...evaluateEligibility(rider, job, ctx) }));
  const eligible = evaluated
    .filter((e) => e.eligible)
    .map((e) => ({ ...e, ...scoreRider(e.rider, job, ctx) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.metrics.jobCount - b.metrics.jobCount ||
        a.etaMinutes - b.etaMinutes ||
        String(a.rider.name).localeCompare(String(b.rider.name)),
    );
  const candidates: Candidate[] = eligible.map((c, index) => {
    const rank = index + 1;
    let explanation = 'Only eligible rider for this job';
    if (eligible.length > 1) {
      if (rank === 1) {
        const gap = explainGap(c, eligible[1]);
        explanation = `Recommended over ${eligible[1].rider.name}: ${gap.text}`;
      } else {
        const gap = explainGap(eligible[0], c);
        explanation = `Ranked below ${eligible[0].rider.name}, who scores ${gap.text}`;
      }
    }
    return {
      rank,
      riderId: idOf(c.rider),
      riderName: c.rider.name,
      vehicle: c.rider.vehicle,
      currentZone: c.rider.currentZone,
      score: c.score,
      etaMinutes: c.etaMinutes,
      travelToPickupMinutes: c.travelToPickupMinutes,
      breakdown: c.breakdown,
      deadline: c.deadline,
      reasons: c.reasons,
      warnings: c.warnings,
      explanation,
      metrics: c.metrics,
    };
  });
  const ineligible = evaluated
    .filter((e) => !e.eligible)
    .map((e) => ({
      riderId: idOf(e.rider),
      riderName: e.rider.name,
      vehicle: e.rider.vehicle,
      reasons: e.reasons,
      metrics: e.metrics,
    }));
  return { weights: WEIGHTS[job.priority ?? 'NORMAL'], candidates, ineligible };
}
