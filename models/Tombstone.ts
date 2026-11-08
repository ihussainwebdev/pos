import { Schema, model, models } from "mongoose";

const TombstoneSchema = new Schema({
  entity: { type: String, required: true },
  remoteId: { type: String, required: true },
  deletedAt: { type: Date, default: () => new Date() },
}, { timestamps: true, versionKey: false });

TombstoneSchema.index({ updatedAt: 1, _id: 1 });

export default models.Tombstone || model("Tombstone", TombstoneSchema);
