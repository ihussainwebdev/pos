import { Schema, model, models } from "mongoose";

const SyncStateSchema = new Schema({
  key: { type: String, required: true, unique: true, index: true },
  status: { type: String, default: "running" },
  session: { type: String, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  stats: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, versionKey: false });

export default models.SyncState || model("SyncState", SyncStateSchema);
