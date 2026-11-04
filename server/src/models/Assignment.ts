import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import {
  ASSIGNMENT_STATUS,
  ASSIGNMENT_STATUS as A,
  type AssignmentSource,
  type AssignmentStatus,
} from '../domain/constants.js';
import type { Actor } from '../domain/types.js';
import { actorSchema } from './actorSchema.js';

const { Schema } = mongoose;

export interface IAssignment {
  jobId: Types.ObjectId;
  riderId: Types.ObjectId;
  attemptNo: number;
  status: AssignmentStatus;
  active: boolean;
  load: number;
  source: AssignmentSource;
  assignedBy?: Actor;
  overrideReason?: string;
  supersedes?: Types.ObjectId;
  recommendation?: {
    rank: number;
    score: number;
    topRiderId: string;
    topRiderName: string;
    topScore: number;
    candidateCount: number;
  };
  assignedAt: Date;
  expiresAt: Date;
  respondedAt?: Date;
  closedAt?: Date;
  closeReason?: string;
  closedBy?: Actor;
}
export type AssignmentDoc = HydratedDocument<IAssignment>;

const assignmentSchema = new Schema<IAssignment>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    riderId: { type: Schema.Types.ObjectId, ref: 'Rider', required: true },
    attemptNo: { type: Number, required: true },
    status: {
      type: String,
      enum: Object.values(ASSIGNMENT_STATUS),
      default: A.PENDING,
      required: true,
    },
    active: { type: Boolean, default: true, required: true },
    load: { type: Number, required: true },
    source: {
      type: String,
      enum: ['RECOMMENDED', 'OVERRIDE', 'AUTO', 'REASSIGNMENT'],
      required: true,
    },
    assignedBy: actorSchema,
    overrideReason: String,
    supersedes: Schema.Types.ObjectId,
    recommendation: new Schema(
      {
        rank: Number,
        score: Number,
        topRiderId: String,
        topRiderName: String,
        topScore: Number,
        candidateCount: Number,
      },
      { _id: false },
    ),
    assignedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    respondedAt: Date,
    closedAt: Date,
    closeReason: String,
    closedBy: actorSchema,
  },
  { timestamps: false, versionKey: false },
);
assignmentSchema.index({ jobId: 1 }, { unique: true, partialFilterExpression: { active: true } });
assignmentSchema.index({ status: 1, expiresAt: 1 });
assignmentSchema.index({ jobId: 1, attemptNo: 1 });
assignmentSchema.index({ riderId: 1, status: 1 });
export const Assignment = mongoose.model<IAssignment>('Assignment', assignmentSchema);
