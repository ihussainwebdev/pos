import { Schema, model, models } from "mongoose";

const AdminSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true, versionKey: false });

export default models.Admin || model("Admin", AdminSchema);
