import { Rider, Assignment, Job, type RiderDoc } from '../models/index.js';
import type { Id, CreateRiderInput, RiderPatch, RiderPlain } from './types.js';
import type { JobRequirements } from '../domain/types.js';
import type { Availability } from '../domain/constants.js';
import type { ZoneName } from '../domain/travel.js';
import { ACTIVE_ASSIGNMENT_STATUSES, AVAILABILITY } from '../domain/constants.js';
import { evaluateEligibility, riderMetrics } from '../domain/ranking.js';
import { clock } from '../lib/clock.js';
import { conflict, notFound } from '../lib/errors.js';

export const riderToPlain = (doc: RiderDoc): RiderPlain => doc.toJSON() as unknown as RiderPlain;

export function presentRider(doc: RiderDoc) {
  const r = riderToPlain(doc);
  const metrics = riderMetrics(r);
  return {
    ...r,
    availableCapacity: metrics.availableCapacity,
    openSlots: metrics.openSlots,
    utilization: Math.round(metrics.utilization * 100) / 100,
    canTakeAnotherDelivery:
      r.availability === AVAILABILITY.AVAILABLE &&
      metrics.availableCapacity > 0 &&
      metrics.openSlots > 0,
  };
}

export async function listRiders({
  availability,
  zone,
}: { availability?: Availability; zone?: ZoneName } = {}) {
  const filter: Record<string, unknown> = {};
  if (availability) filter.availability = availability;
  if (zone) filter.zones = zone;
  const riders = await Rider.find(filter).sort({ name: 1 });
  return riders.map(presentRider);
}

export async function getRider(id: Id) {
  const rider = await Rider.findById(id);
  if (!rider) throw notFound('Rider', id);
  const assignments = await Assignment.find({
    riderId: id,
    status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
  }).sort({ assignedAt: 1 });
  const jobs = await Job.find({ _id: { $in: assignments.map((a) => a.jobId) } }).select(
    'orderId status pickupZone deliveryZone load priority',
  );
  const byId = new Map(jobs.map((j) => [String(j._id), j]));
  return {
    ...presentRider(rider),
    activeAssignments: assignments.map((a) => ({
      ...a.toJSON(),
      job: byId.get(String(a.jobId))?.toJSON() ?? null,
    })),
  };
}

export async function createRider(input: CreateRiderInput) {
  const now = clock.now();
  const rider = await Rider.create({
    ...input,
    homeZone: input.homeZone ?? input.zones[0],
    currentZone: input.currentZone ?? input.homeZone ?? input.zones[0],
    createdAt: now,
    updatedAt: now,
  });
  return presentRider(rider);
}

export async function updateRider(id: Id, patch: RiderPatch) {
  const filter: Record<string, unknown> = { _id: id };
  const guards: unknown[] = [];
  if (patch.capacity !== undefined)
    guards.push({ $gte: [patch.capacity, { $add: ['$activeLoad', '$reservedLoad'] }] });
  if (patch.maxConcurrentJobs !== undefined)
    guards.push({ $gte: [patch.maxConcurrentJobs, { $add: ['$activeJobs', '$pendingJobs'] }] });
  if (guards.length) filter.$expr = { $and: guards };
  const updated = await Rider.findOneAndUpdate(
    filter,
    { $set: { ...patch, updatedAt: clock.now() } },
    { returnDocument: 'after', runValidators: true },
  );
  if (updated) return presentRider(updated);

  const exists = await Rider.exists({ _id: id });
  if (!exists) throw notFound('Rider', id);
  throw conflict(
    'CAPACITY_BELOW_COMMITTED',
    'Capacity or job limit cannot be set below what the rider already carries',
    {
      hint: 'Reassign or complete some of their jobs first',
    },
  );
}
export async function checkFit(id: Id, hypotheticalJob: JobRequirements) {
  const rider = await Rider.findById(id);
  if (!rider) throw notFound('Rider', id);
  const plain = riderToPlain(rider);
  const result = evaluateEligibility(plain, hypotheticalJob);
  return {
    riderId: plain.id,
    riderName: plain.name,
    canTake: result.eligible,
    reasons: result.reasons,
    availableCapacity: result.metrics.availableCapacity,
    openSlots: result.metrics.openSlots,
  };
}
