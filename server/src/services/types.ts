import type { Types } from 'mongoose';
import type { Availability, JobStatus, Priority, Vehicle } from '../domain/constants.js';
import type { Actor, RiderPlain } from '../domain/types.js';
import type { ZoneName } from '../domain/travel.js';
import type { Ranking } from '../domain/ranking.js';

export type { Actor, RiderPlain };

export type Id = string | Types.ObjectId;

export interface CreateJobInput {
  orderId: string;
  pickupZone: ZoneName;
  deliveryZone: ZoneName;
  load: number;
  priority: Priority;
  deadline?: Date | null;
  customerName?: string;
  notes?: string;
}

export interface ListJobsQuery {
  q?: string;
  status?: JobStatus[];
  zone?: ZoneName;
  pickupZone?: ZoneName;
  deliveryZone?: ZoneName;
  priority?: Priority;
  riderId?: string;
  attention?: boolean;
  sort?: 'newest' | 'oldest' | 'priority' | 'deadline';
  page?: number;
  limit?: number;
}

export interface CreateRiderInput {
  name: string;
  phone?: string;
  vehicle?: Vehicle;
  zones: ZoneName[];
  homeZone?: ZoneName;
  currentZone?: ZoneName;
  availability?: Availability;
  capacity: number;
  maxConcurrentJobs: number;
}
export type RiderPatch = Partial<Omit<CreateRiderInput, 'homeZone'>>;

export interface Recommendation extends Ranking {
  jobId: string;
  jobStatus: JobStatus;
  generatedAt: Date;
  topRiderId: string | null;
  hasEligibleRider: boolean;
}

export type Vetted = {
  candidate: Ranking['candidates'][number];
  top: Ranking['candidates'][number];
  isOverride: boolean;
  candidateCount: number;
};
