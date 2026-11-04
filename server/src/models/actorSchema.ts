import mongoose from 'mongoose';

export const actorSchema = new mongoose.Schema(
  { type: { type: String }, id: String, name: String },
  { _id: false },
);
