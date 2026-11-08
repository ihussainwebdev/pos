import { Schema, model, models } from "mongoose";

const CustomerSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  phone: { type: String, default: "", trim: true },
  address: { type: String, default: "", trim: true },
  percentage: { type: Number, default: 0, min: 0, max: 100 },
  clientUid: { type: String, select: false, index: { sparse: true } },
}, { timestamps: true, versionKey: false });

export default models.Customer || model("Customer", CustomerSchema);
