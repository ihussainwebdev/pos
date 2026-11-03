import { connectDB } from "@/lib/db";
import { fail, internalError, ok, serialize } from "@/lib/api";
import Bill from "@/models/Bill";
import Book from "@/models/Book";
import Customer from "@/models/Customer";
import Salesman from "@/models/Salesman";

type IncomingItem = { bookId: string; quantity: number; discountPercent?: number };
type IncomingBill = { customerId?: string; salesmanId: string; walkIn?: { name?: string; phone?: string; address?: string } | null; items: IncomingItem[] };
const safeNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

async function buildBill(input: IncomingBill, oldItems: Array<{ bookId: unknown; quantity: number }> = []) {
  if (!input.salesmanId) throw new Error("Salesman required");
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error("No items provided");
  const salesman = await Salesman.findById(input.salesmanId).lean(); if (!salesman) throw new Error("Salesman not found");
  const customer = input.walkIn ? null : await Customer.findById(input.customerId).lean();
  if (!input.walkIn && !customer) throw new Error("Customer required");
  const requested = new Map<string, number>();
  for (const source of input.items) {
    const quantity = Math.floor(safeNumber(source.quantity)); const discountPercent = safeNumber(source.discountPercent);
    if (!source.bookId || quantity < 1 || discountPercent < 0 || discountPercent > 100) throw new Error("Invalid bill item");
    requested.set(source.bookId, (requested.get(source.bookId) ?? 0) + quantity);
  }
  const oldQuantity = new Map<string, number>();
  for (const item of oldItems) { const key = String(item.bookId); oldQuantity.set(key, (oldQuantity.get(key) ?? 0) + item.quantity); }
  const sourceBooks = await Book.find({ _id: { $in: [...requested.keys()] } }).lean();
  if (sourceBooks.length !== requested.size) throw new Error("Book not found");
  for (const book of sourceBooks) if ((requested.get(String(book._id)) ?? 0) > book.stock + (oldQuantity.get(String(book._id)) ?? 0)) throw new Error(`Insufficient stock for ${book.title}`);
  for (const item of oldItems) await Book.findByIdAndUpdate(String(item.bookId), { $inc: { stock: item.quantity } });
  const items = [] as Array<Record<string, unknown>>;
  let totalAmount = 0; let profit = 0;
  for (const source of input.items) {
    const quantity = Math.floor(safeNumber(source.quantity)); const discountPercent = safeNumber(source.discountPercent);
    if (!source.bookId || quantity < 1 || discountPercent < 0 || discountPercent > 100) throw new Error("Invalid bill item");
    const book = await Book.findOneAndUpdate({ _id: source.bookId, stock: { $gte: quantity } }, { $inc: { stock: -quantity } }, { new: true }).lean();
    if (!book) throw new Error("Insufficient stock or book not found");
    const gross = book.price * quantity; const discountAmount = gross * discountPercent / 100; const total = gross - discountAmount;
    totalAmount += total; profit += total - book.cost * quantity;
    items.push({ bookId: book._id, bookTitle: book.title, quantity, price: book.price, cost: book.cost, discountPercent, gross, discountAmount, total });
  }
  return { salesman, customer, items, totalAmount, profit };
}
async function nextBillNo() { const [latest] = await Bill.aggregate<{ billNo: string }>([{ $match: { billNo: /^\d+$/ } }, { $addFields: { sequence: { $toInt: "$billNo" } } }, { $sort: { sequence: -1 } }, { $limit: 1 }]); return String(latest ? Number(latest.billNo) + 1 : 1001); }
export async function GET(request: Request) { try { await connectDB(); const id = new URL(request.url).searchParams.get("id"); if (id) { const bill = await Bill.findById(id).lean(); return bill ? ok(serialize(bill)) : fail("Bill not found", 404); } return ok((await Bill.find().sort({ createdAt: -1 }).lean()).map(serialize)); } catch (error) { return internalError(error); } }
export async function POST(request: Request) { try { await connectDB(); const url = new URL(request.url); const id = url.searchParams.get("id"); if (id && url.searchParams.get("action") === "refund") { const bill = await Bill.findById(id).lean(); if (!bill) return fail("Bill not found", 404); for (const item of bill.items) await Book.findByIdAndUpdate(item.bookId, { $inc: { stock: item.quantity } }); await Bill.findByIdAndDelete(id); return ok({ message: "Bill refunded and stock restored" }); } const input = await request.json() as IncomingBill; const built = await buildBill(input); const walk = input.walkIn; const bill = await Bill.create({ billNo: await nextBillNo(), customerId: walk ? null : built.customer?._id, customerName: walk ? String(walk.name ?? "").trim() : built.customer?.name, customerPhone: walk ? String(walk.phone ?? "").trim() : built.customer?.phone, customerAddress: walk ? String(walk.address ?? "").trim() : built.customer?.address, salesmanId: built.salesman._id, salesmanName: built.salesman.name, items: built.items, totalAmount: built.totalAmount, profit: built.profit, isWalkIn: Boolean(walk) }); return ok(serialize(bill.toObject()), 201); } catch (error) { return error instanceof Error && /^(Salesman|Customer|No items|Invalid bill item|Book not found|Insufficient stock)/.test(error.message) ? fail(error.message) : internalError(error); } }
export async function PUT(request: Request) { try { await connectDB(); const id = new URL(request.url).searchParams.get("id"); if (!id) return fail("ID required"); const old = await Bill.findById(id).lean(); if (!old) return fail("Bill not found", 404); const input = await request.json() as IncomingBill; const built = await buildBill(input, old.items); const walk = input.walkIn; const bill = await Bill.findByIdAndUpdate(id, { customerId: walk ? null : built.customer?._id, customerName: walk ? String(walk.name ?? "").trim() : built.customer?.name, customerPhone: walk ? String(walk.phone ?? "").trim() : built.customer?.phone, customerAddress: walk ? String(walk.address ?? "").trim() : built.customer?.address, salesmanId: built.salesman._id, salesmanName: built.salesman.name, items: built.items, totalAmount: built.totalAmount, profit: built.profit, isWalkIn: Boolean(walk) }, { new: true }).lean(); return ok(serialize(bill!)); } catch (error) { return error instanceof Error && /^(Salesman|Customer|No items|Invalid bill item|Book not found|Insufficient stock)/.test(error.message) ? fail(error.message) : internalError(error); } }
export async function DELETE(request: Request) { try { await connectDB(); const id = new URL(request.url).searchParams.get("id"); if (!id) return fail("ID required"); const bill = await Bill.findByIdAndDelete(id).lean(); if (!bill) return fail("Bill not found", 404); for (const item of bill.items) await Book.findByIdAndUpdate(item.bookId, { $inc: { stock: item.quantity } }); return ok({ id }); } catch (error) { return internalError(error); } }
