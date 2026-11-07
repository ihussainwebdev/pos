import { Schema, model, models } from "mongoose";

const BillItemSchema = new Schema({
  bookId: { type: Schema.Types.ObjectId, ref: "Book", required: true },
  bookTitle: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
  cost: { type: Number, required: true, min: 0 },
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  gross: { type: Number, required: true },
  discountAmount: { type: Number, required: true },
  total: { type: Number, required: true },
}, { _id: false });

const BillSchema = new Schema({
  billNo: { type: String, required: true, unique: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null },
  customerName: { type: String, default: "" },
  customerPhone: { type: String, default: "" },
  customerAddress: { type: String, default: "" },
  salesmanId: { type: Schema.Types.ObjectId, ref: "Salesman", required: true },
  salesmanName: { type: String, default: "" },
  items: { type: [BillItemSchema], required: true },
  totalAmount: { type: Number, required: true },
  profit: { type: Number, required: true },
  isWalkIn: { type: Boolean, default: false },
  legacySource: { type: String, default: null, select: false },
  legacyId: { type: Number, default: null, select: false },
}, { timestamps: true, versionKey: false });

export default models.Bill || model("Bill", BillSchema);
