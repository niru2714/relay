import { Rider } from '../models/index.js';
import type { Id } from './types.js';
import type { JobRequirements } from '../domain/types.js';
import type { AssignmentStatus } from '../domain/constants.js';
import type { ZoneName } from '../domain/travel.js';
import { AVAILABILITY, ASSIGNMENT_STATUS as A } from '../domain/constants.js';
import { clock } from '../lib/clock.js';

export function reserve(riderId: Id, job: JobRequirements) {
  const zones = [...new Set([job.pickupZone, job.deliveryZone])];
  return Rider.findOneAndUpdate(
    {
      _id: riderId,
      availability: AVAILABILITY.AVAILABLE,
      zones: { $all: zones },
      $expr: {
        $and: [
          { $lte: [{ $add: ['$activeLoad', '$reservedLoad', job.load] }, '$capacity'] },
          { $lt: [{ $add: ['$activeJobs', '$pendingJobs'] }, '$maxConcurrentJobs'] },
        ],
      },
    },
    { $inc: { reservedLoad: job.load, pendingJobs: 1 }, $set: { updatedAt: clock.now() } },
    { returnDocument: 'after' },
  );
}
export const confirm = (riderId: Id, load: number) =>
  Rider.updateOne(
    { _id: riderId },
    {
      $inc: { reservedLoad: -load, pendingJobs: -1, activeLoad: load, activeJobs: 1 },
      $set: { updatedAt: clock.now() },
    },
  );
export const releaseReserved = (riderId: Id, load: number) =>
  Rider.updateOne(
    { _id: riderId },
    { $inc: { reservedLoad: -load, pendingJobs: -1 }, $set: { updatedAt: clock.now() } },
  );

export const releaseActive = (
  riderId: Id,
  load: number,
  { delivered = false, currentZone }: { delivered?: boolean; currentZone?: ZoneName } = {},
) =>
  Rider.updateOne(
    { _id: riderId },
    {
      $inc: { activeLoad: -load, activeJobs: -1, ...(delivered ? { completedCount: 1 } : {}) },
      $set: { updatedAt: clock.now(), ...(currentZone ? { currentZone } : {}) },
    },
  );
export function releaseFor(
  previousStatus: AssignmentStatus,
  riderId: Id,
  load: number,
  opts?: { delivered?: boolean; currentZone?: ZoneName },
) {
  return previousStatus === A.ACCEPTED
    ? releaseActive(riderId, load, opts)
    : releaseReserved(riderId, load);
}
