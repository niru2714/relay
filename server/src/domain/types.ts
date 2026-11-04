import type { ActorType, Availability, JobStatus, Priority, Vehicle } from './constants.js';
import type { ZoneName } from './travel.js';

export interface Actor {
  type: ActorType;
  id: string;
  name: string;
}

export interface RiderPlain {
  id: string;
  name: string;
  vehicle: Vehicle;
  zones: ZoneName[];
  currentZone: ZoneName;
  availability: Availability;
  capacity: number;
  maxConcurrentJobs: number;
  reservedLoad: number;
  pendingJobs: number;
  activeLoad: number;
  activeJobs: number;
}

export interface JobRequirements {
  pickupZone: ZoneName;
  deliveryZone: ZoneName;
  load: number;
  priority?: Priority;
  deadline?: Date | string | null;
}

export interface RiderMetrics {
  committedLoad: number;
  availableCapacity: number;
  jobCount: number;
  openSlots: number;
  utilization: number;
}

export interface EligibilityReason {
  code: string;
  message: string;
}

export type PriorAttempts = Record<string, 'REJECTED' | 'EXPIRED'>;

export interface RankingContext {
  now?: Date;
  priorAttempts?: PriorAttempts;
}

export interface AttentionItem {
  code: string;
  severity: 'critical' | 'warning';
  message: string;
}

export interface AttentionJob {
  status: JobStatus;
  priority: Priority;
  createdAt: Date;
  updatedAt?: Date;
  deadline?: Date | null;
  assignedAt?: Date | null;
  assignmentExpiresAt?: Date | null;
  manualQueue?: { reason?: string | null; enteredAt?: Date | null } | null;
  flags?: { noEligibleRiderSince?: Date | null } | null;
}
