import mongoose, { mongo, Types, type ClientSession } from "mongoose";
import { connectDB } from "@/lib/db";
import { fail, internalError, ok } from "@/lib/api";
import { recordDeletion, rejectSyncRequest, type SyncEntity } from "@/lib/sync";
import Bill from "@/models/Bill";
import Book from "@/models/Book";
import Customer from "@/models/Customer";
import Salesman from "@/models/Salesman";

type Row = Record<string, unknown>;
type Ref = { remoteId?: string | null; uid?: string | null } | null | undefined;
type Op = Row & { seq: number; kind: string; entity: SyncEntity; remoteId?: string | null; uid?: string | null; opId?: string | null };

const MAX_OPS = 50;
const SOURCE = "bestpublishers-desktop";
const LEDGER_TTL_SECONDS = 30 * 24 * 60 * 60;

class PermanentError extends Error {}

// Processed-op ledger makes retries idempotent: a committed op is never applied twice.
const ledger = () => mongoose.connection.getClient().db().collection("syncops");
let ledgerIndexes: Promise<unknown> | null = null;
function ensureLedger() {
  ledgerIndexes ||= Promise.all([
    ledger().createIndex({ opId: 1 }, { unique: true }),
    ledger().createIndex({ processedAt: 1 }, { expireAfterSeconds: LEDGER_TTL_SECONDS }),
  ]);
  return ledgerIndexes;
}
const isDuplicateKey = (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: number }).code === 11000);

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const nonNegative = (value: unknown) => Math.max(0, number(value));
const sourceDate = (value: unknown) => { const date = new Date(String(value ?? "")); return Number.isNaN(date.getTime()) ? null : date; };
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const titleFilter = (title: string) => ({ title: { $regex: `^${escapeRegex(title)}$`, $options: "i" } });

function collectionOf(entity: SyncEntity) {
  const model = { book: Book, customer: Customer, salesman: Salesman, bill: Bill }[entity];
  if (!model) throw new PermanentError(`Unknown entity ${entity}`);
  return model.collection as unknown as mongo.Collection<mongo.Document>;
}

async function findRef(entity: SyncEntity, ref: Ref, session?: ClientSession) {
  const collection = collectionOf(entity);
  const options = session ? { session } : {};
  if (ref?.remoteId && Types.ObjectId.isValid(ref.remoteId)) {
    const doc = await collection.findOne({ _id: new Types.ObjectId(ref.remoteId) }, options);
    if (doc) return doc;
  }
  if (ref?.uid) {
    const doc = await collection.findOne({ clientUid: String(ref.uid) }, options);
    if (doc) return doc;
  }
  return null;
}

// A record deleted on the server can still be referenced by an older bill being edited.
function danglingRef(ref: Ref, fields: mongo.Document): mongo.Document | null {
  return ref?.remoteId && Types.ObjectId.isValid(ref.remoteId) ? { _id: new Types.ObjectId(ref.remoteId), ...fields } : null;
}

function masterFields(entity: SyncEntity, data: Row) {
  if (entity === "book") return { title: text(data.title), price: nonNegative(data.price), cost: nonNegative(data.cost) };
  if (entity === "customer") return { name: text(data.name), phone: text(data.phone), address: text(data.address), percentage: Math.min(100, nonNegative(data.percentage)) };
  if (entity === "salesman") return { name: text(data.name), phone: text(data.phone) };
  throw new PermanentError(`Unknown entity ${entity}`);
}

async function upsertMaster(op: Op, session: ClientSession) {
  const data = (op.data ?? {}) as Row;
  const fields = masterFields(op.entity, data);
  if (op.entity === "book" ? !("title" in fields) || !fields.title : !("name" in fields) || !fields.name) throw new PermanentError("Name/title is required");
  const collection = collectionOf(op.entity);
  const now = new Date();
  const stockDelta = Math.trunc(number(op.stockDelta));
  const title = op.entity === "book" ? text(data.title) : "";

  let doc = await findRef(op.entity, op, session);
  if (!doc && title) doc = await collection.findOne(titleFilter(title), { session });

  if (doc) {
    if (title) {
      const duplicate = await collection.findOne({ _id: { $ne: doc._id }, ...titleFilter(title) }, { session });
      if (duplicate) throw new PermanentError("Book with this title already exists!");
    }
    const update: mongo.UpdateFilter<mongo.Document> = { $set: { ...fields, updatedAt: now } };
    if (op.entity === "book" && stockDelta) update.$inc = { stock: stockDelta };
    await collection.updateOne({ _id: doc._id }, update, { session });
    return { remoteId: doc._id.toString() };
  }

  const insert: mongo.Document = { ...fields, clientUid: text(op.uid) || undefined, createdAt: sourceDate(data.created_at) ?? now, updatedAt: now };
  if (op.entity === "book") insert.stock = Math.trunc(number(data.stock));
  const result = await collection.insertOne(insert, { session });
  return { remoteId: result.insertedId.toString() };
}

async function changeStock(op: Op, session: ClientSession) {
  const doc = await findRef("book", op, session);
  if (!doc) return { remoteId: null, missing: true };
  const delta = Math.trunc(number(op.delta));
  if (delta) await collectionOf("book").updateOne({ _id: doc._id }, { $inc: { stock: delta }, $set: { updatedAt: new Date() } }, { session });
  return { remoteId: doc._id.toString() };
}

async function deleteMaster(op: Op, session: ClientSession) {
  const doc = await findRef(op.entity, op, session);
  if (!doc) return { remoteId: null, missing: true };
  await collectionOf(op.entity).deleteOne({ _id: doc._id }, { session });
  await recordDeletion(op.entity, doc._id.toString(), session);
  return { remoteId: doc._id.toString() };
}

async function adjustStock(items: Array<{ bookId: unknown; quantity: unknown }>, sign: 1 | -1, session: ClientSession) {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(String(item.bookId), (totals.get(String(item.bookId)) ?? 0) + number(item.quantity));
  const now = new Date();
  for (const [bookId, quantity] of totals) {
    if (!quantity || !Types.ObjectId.isValid(bookId)) continue;
    await collectionOf("book").updateOne({ _id: new Types.ObjectId(bookId) }, { $inc: { stock: sign * quantity }, $set: { updatedAt: now } }, { session });
  }
}

async function upsertBill(op: Op, session: ClientSession) {
  const data = (op.data ?? {}) as Row;
  let outcome: { remoteId: string; billNo: string } | null = null;

  {
    const isWalkIn = Boolean(data.isWalkIn);
    const salesmanRef = data.salesman as Ref;
    const salesman = await findRef("salesman", salesmanRef, session) ?? danglingRef(salesmanRef, { name: text(data.salesmanName) });
    if (!salesman) throw new PermanentError("Salesman not found on server");
    const customer = isWalkIn ? null : await findRef("customer", data.customer as Ref, session);

    const items: mongo.Document[] = [];
    for (const source of Array.isArray(data.items) ? data.items as Row[] : []) {
      const bookRef = source.book as Ref;
      const book = await findRef("book", bookRef, session) ?? danglingRef(bookRef, { title: text(source.bookTitle), cost: nonNegative(source.cost) });
      if (!book) throw new PermanentError(`Book not found on server: ${text(source.bookTitle) || "unknown"}`);
      const quantity = Math.max(1, Math.floor(number(source.quantity, 1)));
      const price = nonNegative(source.price);
      const discountPercent = Math.min(100, nonNegative(source.discountPercent));
      const gross = price * quantity;
      const total = source.total === undefined || source.total === null ? gross * (1 - discountPercent / 100) : nonNegative(source.total);
      items.push({ bookId: book._id, bookTitle: text(source.bookTitle) || text(book.title), quantity, price, cost: nonNegative(book.cost), discountPercent, gross, discountAmount: Math.max(0, gross - total), total });
    }
    if (!items.length) throw new PermanentError("Bill has no items");

    const now = new Date();
    const fields = {
      customerId: customer ? customer._id : null,
      customerName: isWalkIn ? text(data.customerName) : text(customer?.name ?? data.customerName),
      customerPhone: isWalkIn ? text(data.customerPhone) : text(customer?.phone ?? data.customerPhone),
      customerAddress: isWalkIn ? text(data.customerAddress) : text(customer?.address ?? data.customerAddress),
      salesmanId: salesman._id,
      salesmanName: text(salesman.name),
      items,
      totalAmount: number(data.totalAmount, items.reduce((sum, item) => sum + number(item.total), 0)),
      profit: number(data.profit, items.reduce((sum, item) => sum + number(item.total) - number(item.cost) * number(item.quantity), 0)),
      isWalkIn,
      updatedAt: now,
    };

    const bills = collectionOf("bill");
    const existing = await findRef("bill", op, session);
    if (existing) {
      await adjustStock(Array.isArray(existing.items) ? existing.items : [], 1, session);
      await bills.updateOne({ _id: existing._id }, { $set: fields }, { session });
      await adjustStock(items as Array<{ bookId: unknown; quantity: unknown }>, -1, session);
      outcome = { remoteId: existing._id.toString(), billNo: String(existing.billNo) };
      return outcome;
    }

    const legacyId = number(data.legacyId, Number.NaN);
    const baseBillNo = text(data.billNo) || `DESKTOP-${Number.isFinite(legacyId) ? legacyId : Date.now()}`;
    let billNo = baseBillNo;
    for (let suffix = 2; await bills.findOne({ billNo }, { session, projection: { _id: 1 } }); suffix += 1) billNo = `${baseBillNo}-${suffix}`;

    const result = await bills.insertOne({
      billNo,
      ...fields,
      clientUid: text(op.uid) || undefined,
      legacySource: SOURCE,
      legacyId: Number.isFinite(legacyId) ? legacyId : null,
      createdAt: sourceDate(data.createdAt) ?? now,
    }, { session });
    await adjustStock(items as Array<{ bookId: unknown; quantity: unknown }>, -1, session);
    outcome = { remoteId: result.insertedId.toString(), billNo };
  }

  return outcome!;
}

async function deleteBill(op: Op, session: ClientSession) {
  let outcome: { remoteId: string | null; missing?: boolean } = { remoteId: null, missing: true };
  {
    const doc = await findRef("bill", op, session);
    if (!doc) { outcome = { remoteId: null, missing: true }; return outcome; }
    await adjustStock(Array.isArray(doc.items) ? doc.items : [], 1, session);
    await collectionOf("bill").deleteOne({ _id: doc._id }, { session });
    await recordDeletion("bill", doc._id.toString(), session);
    outcome = { remoteId: doc._id.toString() };
  }
  return outcome;
}

async function apply(op: Op, session: ClientSession) {
  if (op.kind === "upsert" && op.entity !== "bill") return upsertMaster(op, session);
  if (op.kind === "stock" && op.entity === "book") return changeStock(op, session);
  if (op.kind === "delete" && op.entity !== "bill") return deleteMaster(op, session);
  if (op.kind === "bill" && op.entity === "bill") return upsertBill(op, session);
  if (op.kind === "bill_delete" && op.entity === "bill") return deleteBill(op, session);
  throw new PermanentError(`Unknown operation ${op.kind}/${op.entity}`);
}

// Runs the op and its ledger record in one transaction so a retry replays the
// stored result instead of re-applying stock deltas or re-inserting a bill.
async function applyIdempotent(op: Op): Promise<Row> {
  const opId = text(op.opId);
  if (!opId) {
    let plain: Row = {};
    await mongoose.connection.transaction(async (session) => { plain = await apply(op, session); });
    return plain;
  }
  await ensureLedger();
  try {
    let stored: Row | null = null;
    await mongoose.connection.transaction(async (session) => {
      const existing = await ledger().findOne({ opId }, { session });
      if (existing) { stored = existing.result as Row; return; }
      const result = await apply(op, session);
      await ledger().insertOne({ opId, result, processedAt: new Date() }, { session });
      stored = result;
    });
    return stored!;
  } catch (error) {
    if (isDuplicateKey(error)) {
      const existing = await ledger().findOne({ opId });
      if (existing) return existing.result as Row;
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const denied = rejectSyncRequest(request);
  if (denied) return denied;
  try {
    await connectDB();
    const body = await request.json().catch(() => ({})) as { ops?: Op[] };
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, MAX_OPS) : [];
    if (!ops.length) return fail("No operations");

    const results: Row[] = [];
    for (const op of ops) {
      try {
        results.push({ seq: op.seq, ok: true, ...(await applyIdempotent(op)) });
      } catch (error) {
        if (error instanceof PermanentError) { results.push({ seq: op.seq, ok: false, permanent: true, error: error.message }); continue; }
        console.error("Sync push operation failed", op.kind, op.entity, error);
        return ok({ results, stopped: true, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return ok({ results, stopped: false });
  } catch (error) {
    return internalError(error);
  }
}
