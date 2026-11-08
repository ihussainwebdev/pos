import { Schema, model, models } from "mongoose";

const BookSchema = new Schema({
  title: { type: String, required: true, trim: true, unique: true, index: true },
  price: { type: Number, required: true, min: 0, default: 0 },
  cost: { type: Number, required: true, min: 0, default: 0 },
  stock: { type: Number, required: true, min: 0, default: 0 },
  clientUid: { type: String, select: false, index: { sparse: true } },
}, { timestamps: true, versionKey: false });

export default models.Book || model("Book", BookSchema);
