import { Schema, model, models } from "mongoose";

const SalesmanSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  phone: { type: String, default: "", trim: true },
  clientUid: { type: String, select: false, index: { sparse: true } },
}, { timestamps: true, versionKey: false });

export default models.Salesman || model("Salesman", SalesmanSchema);
