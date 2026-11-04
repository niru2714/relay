import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import { EVENT_TYPE, JOB_STATUSES, type EventType, type JobStatus } from '../domain/constants.js';
import type { Actor } from '../domain/types.js';
import { actorSchema } from './actorSchema.js';

const { Schema } = mongoose;

export interface IJobEvent {
  jobId: Types.ObjectId;
  type: EventType;
  at: Date;
  actor?: Actor;
  fromStatus?: JobStatus | null;
  toStatus?: JobStatus | null;
  riderId?: Types.ObjectId;
  assignmentId?: Types.ObjectId;
  message?: string;
  details?: unknown;
}
export type JobEventDoc = HydratedDocument<IJobEvent>;

const jobEventSchema = new Schema<IJobEvent>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    type: { type: String, enum: Object.values(EVENT_TYPE), required: true },
    at: { type: Date, required: true },
    actor: actorSchema,
    fromStatus: { type: String, enum: [...JOB_STATUSES, null] },
    toStatus: { type: String, enum: [...JOB_STATUSES, null] },
    riderId: Schema.Types.ObjectId,
    assignmentId: Schema.Types.ObjectId,
    message: String,
    details: Schema.Types.Mixed,
  },
  { timestamps: false, versionKey: false },
);
jobEventSchema.index({ jobId: 1, _id: 1 });
jobEventSchema.index({ type: 1, at: -1 });
export const JobEvent = mongoose.model<IJobEvent>('JobEvent', jobEventSchema);
