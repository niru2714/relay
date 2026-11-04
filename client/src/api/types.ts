export type JobStatus =
  | 'NEW'
  | 'READY_FOR_ASSIGNMENT'
  | 'AWAITING_CONFIRMATION'
  | 'ACCEPTED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'MANUAL_QUEUE'
  | 'CANCELLED';
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type Availability = 'AVAILABLE' | 'ON_BREAK' | 'OFFLINE';
export type Vehicle = 'BIKE' | 'SCOOTER' | 'VAN';
export type AssignmentStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'WITHDRAWN'
  | 'REASSIGNED'
  | 'CANCELLED'
  | 'COMPLETED';

export interface Actor {
  type: 'DISPATCHER' | 'RIDER' | 'SYSTEM';
  id: string;
  name: string;
}
export interface AttentionItem {
  code: string;
  severity: 'critical' | 'warning';
  message: string;
}

export interface Job {
  id: string;
  orderId: string;
  pickupZone: string;
  deliveryZone: string;
  load: number;
  priority: Priority;
  priorityRank: number;
  deadline: string | null;
  status: JobStatus;
  customerName?: string;
  notes?: string;
  assignedRiderId: string | null;
  assignedRider: { id: string; name: string } | null;
  currentAssignmentId?: string;
  assignmentExpiresAt?: string;
  assignedAt?: string;
  attemptCount: number;
  manualQueue?: { reason?: string; detail?: string; enteredAt?: string };
  flags?: { noEligibleRiderSince?: string };
  cancellation?: { reason?: string; at?: string; by?: string };
  attention: AttentionItem[];
  createdAt: string;
  updatedAt: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  createdBy?: string;
}

export interface Assignment {
  id: string;
  jobId: string;
  riderId: string;
  riderName?: string;
  attemptNo: number;
  status: AssignmentStatus;
  active: boolean;
  load: number;
  source: 'RECOMMENDED' | 'OVERRIDE' | 'AUTO' | 'REASSIGNMENT';
  assignedBy?: Actor;
  overrideReason?: string;
  recommendation?: {
    rank: number;
    score: number;
    topRiderName: string;
    topScore: number;
    candidateCount: number;
  };
  assignedAt: string;
  expiresAt: string;
  respondedAt?: string;
  closedAt?: string;
  closeReason?: string;
}

export interface JobEvent {
  id: string;
  type: string;
  at: string;
  actor?: Actor;
  fromStatus?: JobStatus | null;
  toStatus?: JobStatus | null;
  message?: string;
  details?: Record<string, unknown>;
}

export interface Rider {
  id: string;
  name: string;
  phone?: string;
  vehicle: Vehicle;
  zones: string[];
  homeZone: string;
  currentZone: string;
  availability: Availability;
  capacity: number;
  maxConcurrentJobs: number;
  reservedLoad: number;
  pendingJobs: number;
  activeLoad: number;
  activeJobs: number;
  completedCount: number;
  availableCapacity: number;
  openSlots: number;
  utilization: number;
  canTakeAnotherDelivery: boolean;
}

export interface FactorScore {
  value: number;
  weight: number;
  points: number;
}
export interface Candidate {
  rank: number;
  riderId: string;
  riderName: string;
  vehicle: Vehicle;
  currentZone: string;
  score: number;
  etaMinutes: number;
  travelToPickupMinutes: number;
  breakdown: Record<'travel' | 'workload' | 'fit' | 'deadline', FactorScore>;
  deadline: { minutesLeft: number; slackMinutes: number; atRisk: boolean } | null;
  reasons: string[];
  warnings: string[];
  explanation: string;
}
export interface Ineligible {
  riderId: string;
  riderName: string;
  vehicle: Vehicle;
  reasons: { code: string; message: string }[];
}
export interface Recommendation {
  jobId: string;
  weights: Record<string, number>;
  candidates: Candidate[];
  ineligible: Ineligible[];
  topRiderId: string | null;
  hasEligibleRider: boolean;
}

export interface Dashboard {
  generatedAt: string;
  totals: {
    received: number;
    awaitingAssignment: number;
    awaitingConfirmation: number;
    inProgress: number;
    manualQueue: number;
    completed: number;
    cancelled: number;
  };
  inProgressBreakdown: { accepted: number; pickedUp: number };
  byStatus: Record<JobStatus, number>;
  attention: { total: number; critical: number; items: Job[] };
  riders: {
    total: number;
    available: number;
    onBreak: number;
    offline: number;
    capacityUtilization: number;
  };
  config: SystemConfig;
}

export interface SystemConfig {
  assignmentTimeoutMinutes: number;
  autoDispatch: boolean;
  simulatedClock: boolean;
  clockOffsetMinutes: number;
  now?: string;
}

export interface Meta {
  zones: { name: string; x: number; y: number }[];
  statuses: JobStatus[];
  priorities: Priority[];
  availabilities: Availability[];
  vehicles: Vehicle[];
  config: SystemConfig & { demoEndpoints: boolean };
}

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}
export interface JobDetail extends Job {
  currentAssignment: Assignment | null;
}
export interface FitResult {
  riderId: string;
  riderName: string;
  canTake: boolean;
  reasons: { code: string; message: string }[];
  availableCapacity: number;
  openSlots: number;
}
export interface Integrity {
  ok: boolean;
  ledgerDrift: unknown[];
  jobsWithMultipleOpenAssignments: string[];
  brokenLinks: unknown[];
}
