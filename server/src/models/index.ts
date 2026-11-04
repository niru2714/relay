import mongoose from 'mongoose';

mongoose.set('toJSON', {
  virtuals: false,
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    if (ret._id !== undefined) {
      ret.id = String(ret._id);
      delete ret._id;
    }
    delete ret.payloadHash;
    return ret;
  },
});
mongoose.set('strictQuery', true);

export { Job, type IJob, type JobDoc } from './Job.js';
export { Rider, type IRider, type RiderDoc } from './Rider.js';
export { Assignment, type IAssignment, type AssignmentDoc } from './Assignment.js';
export { JobEvent, type IJobEvent, type JobEventDoc } from './JobEvent.js';
