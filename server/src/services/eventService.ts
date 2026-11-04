import { JobEvent } from '../models/index.js';
import type { EventType, JobStatus } from '../domain/constants.js';
import type { Actor, Id } from './types.js';
import { clock } from '../lib/clock.js';

export interface NewEvent {
  jobId: Id;
  type: EventType;
  actor?: Actor;
  fromStatus?: JobStatus | null;
  toStatus?: JobStatus | null;
  riderId?: Id;
  assignmentId?: Id;
  message?: string;
  details?: unknown;
}

export function recordEvent({
  jobId,
  type,
  actor,
  fromStatus = null,
  toStatus = null,
  riderId,
  assignmentId,
  message,
  details,
}: NewEvent) {
  return JobEvent.create({
    jobId,
    type,
    at: clock.now(),
    actor,
    fromStatus,
    toStatus,
    riderId,
    assignmentId,
    message,
    details,
  });
}

export async function listEvents(jobId: Id) {
  const events = await JobEvent.find({ jobId }).sort({ _id: 1 });
  return events.map((e) => e.toJSON());
}
