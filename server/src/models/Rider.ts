import mongoose, { type HydratedDocument } from 'mongoose';
import {
  AVAILABILITIES,
  AVAILABILITY,
  VEHICLES,
  type Availability,
  type Vehicle,
} from '../domain/constants.js';
import { ZONE_NAMES, type ZoneName } from '../domain/travel.js';

export interface IRider {
  name: string;
  phone?: string;
  vehicle: Vehicle;
  zones: ZoneName[];
  homeZone: ZoneName;
  currentZone: ZoneName;
  availability: Availability;
  capacity: number;
  maxConcurrentJobs: number;
  reservedLoad: number;
  pendingJobs: number;
  activeLoad: number;
  activeJobs: number;
  completedCount: number;
  createdAt: Date;
  updatedAt: Date;
}
export type RiderDoc = HydratedDocument<IRider>;

const { Schema } = mongoose;

const riderSchema = new Schema<IRider>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, trim: true },
    vehicle: { type: String, enum: [...VEHICLES], default: 'SCOOTER' },
    zones: { type: [{ type: String, enum: ZONE_NAMES }], validate: (v: unknown[]) => v.length > 0 },
    homeZone: { type: String, enum: ZONE_NAMES, required: true },
    currentZone: { type: String, enum: ZONE_NAMES, required: true },
    availability: { type: String, enum: AVAILABILITIES, default: AVAILABILITY.AVAILABLE },
    capacity: { type: Number, required: true, min: 1 },
    maxConcurrentJobs: { type: Number, required: true, min: 1 },
    reservedLoad: { type: Number, default: 0, min: 0 },
    pendingJobs: { type: Number, default: 0, min: 0 },
    activeLoad: { type: Number, default: 0, min: 0 },
    activeJobs: { type: Number, default: 0, min: 0 },
    completedCount: { type: Number, default: 0 },

    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { timestamps: false, versionKey: false },
);
riderSchema.index({ availability: 1, zones: 1 });
riderSchema.index({ name: 1 });

export const Rider = mongoose.model<IRider>('Rider', riderSchema);
