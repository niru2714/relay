import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import {
  JOB_STATUSES,
  JOB_STATUS,
  PRIORITIES,
  PRIORITY,
  type JobStatus,
  type Priority,
} from '../domain/constants.js';
import type { ZoneName } from '../domain/travel.js';

export interface IJob {
  orderId: string;
  payloadHash: string;
  customerName?: string;
  notes?: string;
  pickupZone: ZoneName;
  deliveryZone: ZoneName;
  load: number;
  priority: Priority;
  priorityRank: number;
  deadline: Date | null;
  status: JobStatus;
  currentAssignmentId?: Types.ObjectId;
  assignedRiderId?: Types.ObjectId;
  assignedAt?: Date;
  assignmentExpiresAt?: Date;
  attemptCount: number;
  manualQueue?: {
    reason?: string;
    detail?: string;
    enteredAt?: Date;
    previousRiderId?: Types.ObjectId;
    previousAssignmentId?: Types.ObjectId;
  };
  flags?: { noEligibleRiderSince?: Date };
  cancellation?: { reason?: string; at?: Date; by?: string };
  pickedUpAt?: Date;
  deliveredAt?: Date;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}
export type JobDoc = HydratedDocument<IJob>;

const { Schema } = mongoose;

const jobSchema = new Schema<IJob>(
  {
    orderId: { type: String, required: true, trim: true, uppercase: true },
    payloadHash: { type: String, required: true },
    customerName: { type: String, trim: true, maxlength: 80 },
    notes: { type: String, trim: true, maxlength: 500 },
    pickupZone: { type: String, required: true },
    deliveryZone: { type: String, required: true },
    load: { type: Number, required: true, min: 1 },
    priority: { type: String, enum: PRIORITIES, default: PRIORITY.NORMAL },
    priorityRank: { type: Number, required: true },
    deadline: { type: Date, default: null },

    status: { type: String, enum: JOB_STATUSES, default: JOB_STATUS.NEW, required: true },
    currentAssignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment' },
    assignedRiderId: { type: Schema.Types.ObjectId, ref: 'Rider' },
    assignedAt: Date,
    assignmentExpiresAt: Date,
    attemptCount: { type: Number, default: 0 },
    manualQueue: new Schema(
      {
        reason: String,
        detail: String,
        enteredAt: Date,
        previousRiderId: Schema.Types.ObjectId,
        previousAssignmentId: Schema.Types.ObjectId,
      },
      { _id: false },
    ),
    flags: new Schema({ noEligibleRiderSince: Date }, { _id: false }),
    cancellation: new Schema({ reason: String, at: Date, by: String }, { _id: false }),
    pickedUpAt: Date,
    deliveredAt: Date,
    createdBy: String,
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { timestamps: false, versionKey: false },
);
jobSchema.index({ orderId: 1 }, { unique: true });
jobSchema.index({ status: 1, priorityRank: -1, createdAt: 1 });
jobSchema.index({ pickupZone: 1, status: 1 });
jobSchema.index({ deliveryZone: 1, status: 1 });
jobSchema.index({ assignedRiderId: 1, status: 1 }, { sparse: true });
export const Job = mongoose.model<IJob>('Job', jobSchema);
