import { randomUUID } from "crypto";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { fail, internalError, ok } from "@/lib/api";
import Bill from "@/models/Bill";
import Book from "@/models/Book";
import Customer from "@/models/Customer";
import Salesman from "@/models/Salesman";
import SyncState from "@/models/SyncState";

const STATE_KEY = "initialImport";
const MAX_BILLS_PER_REQUEST = 200;

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : [];
const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const nonNegative = (value: unknown) => Math.max(0, number(value));
const sourceDate = (value: unknown) => { const date = new Date(String(value ?? "")); return Number.isNaN(date.getTime()) ? null : date; };
const keyOf = (...parts: string[]) => parts.map((part) => part.trim().toLowerCase()).join("|");

async function importMasters(body: Row) {
  const sourceBooks = rows(body.books);
  const sourceCustomers = rows(body.customers);
  const sourceSalesmen = rows(body.salesmen);

  const uniqueBooks = new Map<string, Row>();
  for (const row of sourceBooks) {
    const title = text(row.title);
    if (title && !uniqueBooks.has(title.toLowerCase())) uniqueBooks.set(title.toLowerCase(), row);
  }
  const uniqueCustomers = new Map<string, Row>();
  for (const row of sourceCustomers) {
    const name = text(row.name);
    if (name) { const key = keyOf(name, text(row.phone)); if (!uniqueCustomers.has(key)) uniqueCustomers.set(key, row); }
  }
  const uniqueSalesmen = new Map<string, Row>();
  for (const row of sourceSalesmen) {
    const name = text(row.name);
    if (name) { const key = keyOf(name, text(row.phone)); if (!uniqueSalesmen.has(key)) uniqueSalesmen.set(key, row); }
  }

  const [existingBooks, existingCustomers, existingSalesmen] = await Promise.all([
    Book.find({}).select("_id title").lean(),
    Customer.find({}).select("_id name phone").lean(),
    Salesman.find({}).select("_id name phone").lean(),
  ]);

  const bookIds = new Map(existingBooks.map((row) => [String(row.title).trim().toLowerCase(), row._id.toString()]));
  const customerIds = new Map(existingCustomers.map((row) => [keyOf(String(row.name), String(row.phone ?? "")), row._id.toString()]));
  const salesmanIds = new Map(existingSalesmen.map((row) => [keyOf(String(row.name), String(row.phone ?? "")), row._id.toString()]));

  const newBooks = [...uniqueBooks].filter(([key]) => !bookIds.has(key)).map(([, row]) => {
    const createdAt = sourceDate(row.created_at);
    return { title: text(row.title), price: nonNegative(row.price), cost: nonNegative(row.cost), stock: Math.max(0, Math.floor(nonNegative(row.stock))), ...(createdAt ? { createdAt } : {}) };
  });
  const newCustomers = [...uniqueCustomers].filter(([key]) => !customerIds.has(key)).map(([, row]) => {
    const createdAt = sourceDate(row.created_at);
    return { name: text(row.name), phone: text(row.phone), address: text(row.address), percentage: Math.min(100, Math.max(0, number(row.percentage))), ...(createdAt ? { createdAt } : {}) };
  });
  const newSalesmen = [...uniqueSalesmen].filter(([key]) => !salesmanIds.has(key)).map(([, row]) => {
    const createdAt = sourceDate(row.created_at);
    return { name: text(row.name), phone: text(row.phone), ...(createdAt ? { createdAt } : {}) };
  });

  if (newBooks.length) { try { await Book.insertMany(newBooks, { ordered: false }); } catch { /* duplicates are already present */ } }
  if (newCustomers.length) { try { await Customer.insertMany(newCustomers, { ordered: false }); } catch { /* duplicates are already present */ } }
  if (newSalesmen.length) { try { await Salesman.insertMany(newSalesmen, { ordered: false }); } catch { /* duplicates are already present */ } }

  if (newBooks.length || newCustomers.length || newSalesmen.length) {
    const [books, customers, salesmen] = await Promise.all([
      Book.find({}).select("_id title").lean(),
      Customer.find({}).select("_id name phone").lean(),
      Salesman.find({}).select("_id name phone").lean(),
    ]);
    bookIds.clear(); for (const row of books) bookIds.set(String(row.title).trim().toLowerCase(), row._id.toString());
    customerIds.clear(); for (const row of customers) customerIds.set(keyOf(String(row.name), String(row.phone ?? "")), row._id.toString());
    salesmanIds.clear(); for (const row of salesmen) salesmanIds.set(keyOf(String(row.name), String(row.phone ?? "")), row._id.toString());
  }

  const maps = { books: {} as Record<string, string>, customers: {} as Record<string, string>, salesmen: {} as Record<string, string> };
  for (const row of sourceBooks) { const id = text(row.id); const target = bookIds.get(text(row.title).toLowerCase()); if (id && target) maps.books[id] = target; }
  for (const row of sourceCustomers) { const id = text(row.id); const target = customerIds.get(keyOf(text(row.name), text(row.phone))); if (id && target) maps.customers[id] = target; }
  for (const row of sourceSalesmen) { const id = text(row.id); const target = salesmanIds.get(keyOf(text(row.name), text(row.phone))); if (id && target) maps.salesmen[id] = target; }

  return {
    books: { received: sourceBooks.length, unique: uniqueBooks.size, created: newBooks.length },
    customers: { received: sourceCustomers.length, unique: uniqueCustomers.size, created: newCustomers.length },
    salesmen: { received: sourceSalesmen.length, unique: uniqueSalesmen.size, created: newSalesmen.length },
    maps,
  };
}

async function importBills(body: Row) {
  const sourceBills = rows(body.bills).slice(0, MAX_BILLS_PER_REQUEST);

  const salesmanIds = new Set<string>();
  const customerIds = new Set<string>();
  const bookIds = new Set<string>();
  for (const bill of sourceBills) {
    const salesmanId = text(bill.salesmanId); if (Types.ObjectId.isValid(salesmanId)) salesmanIds.add(salesmanId);
    const customerId = text(bill.customerId); if (Types.ObjectId.isValid(customerId)) customerIds.add(customerId);
    for (const item of rows(bill.items)) { const bookId = text(item.bookId); if (Types.ObjectId.isValid(bookId)) bookIds.add(bookId); }
  }

  const [salesmen, customers, books, existing] = await Promise.all([
    Salesman.find({ _id: { $in: [...salesmanIds] } }).select("_id name").lean(),
    Customer.find({ _id: { $in: [...customerIds] } }).select("_id").lean(),
    Book.find({ _id: { $in: [...bookIds] } }).select("_id title price cost").lean(),
    Bill.collection.find({}, { projection: { billNo: 1, legacyId: 1 } }).toArray(),
  ]);

  const salesmanById = new Map(salesmen.map((row) => [row._id.toString(), row]));
  const customerIdSet = new Set(customers.map((row) => row._id.toString()));
  const bookById = new Map(books.map((row) => [row._id.toString(), row]));
  const usedBillNos = new Set(existing.map((row) => String(row.billNo)));
  const importedLegacyIds = new Set(existing.map((row) => (row as { legacyId?: number | null }).legacyId).filter((value): value is number => typeof value === "number"));

  type Operation = { updateOne: { filter: { billNo: string }; update: { $setOnInsert: Row }; upsert: true } };
  const operations: Operation[] = [];
  let skipped = 0;
  let renamed = 0;

  for (const source of sourceBills) {
    const legacyId = number(source.sourceId, Number.NaN);
    if (Number.isFinite(legacyId) && importedLegacyIds.has(legacyId)) { skipped += 1; continue; }

    const baseBillNo = text(source.billNo) || (Number.isFinite(legacyId) ? `LEGACY-${legacyId}` : "");
    const salesmanId = text(source.salesmanId);
    const salesman = salesmanById.get(salesmanId);
    if (!baseBillNo || !salesman) { skipped += 1; continue; }

    const items: Row[] = [];
    for (const sourceItem of rows(source.items)) {
      const bookId = text(sourceItem.bookId);
      const book = bookById.get(bookId);
      if (!book) continue;
      const quantity = Math.max(1, Math.floor(number(sourceItem.quantity, 1)));
      const price = nonNegative(sourceItem.price) || number(book.price);
      const cost = sourceItem.cost === undefined ? number(book.cost) : nonNegative(sourceItem.cost);
      const discountPercent = Math.min(100, Math.max(0, number(sourceItem.discountPercent)));
      const gross = sourceItem.gross === undefined ? price * quantity : nonNegative(sourceItem.gross);
      const total = sourceItem.total === undefined ? gross * (1 - discountPercent / 100) : nonNegative(sourceItem.total);
      const discountAmount = sourceItem.discountAmount === undefined ? Math.max(0, gross - total) : nonNegative(sourceItem.discountAmount);
      items.push({
        bookId: new Types.ObjectId(bookId),
        bookTitle: text(sourceItem.bookTitle) || String(book.title),
        quantity, price, cost, discountPercent, gross, discountAmount, total,
      });
    }

    let billNo = baseBillNo;
    if (usedBillNos.has(billNo)) {
      let suffix = 2;
      while (usedBillNos.has(`${baseBillNo}-${suffix}`)) suffix += 1;
      billNo = `${baseBillNo}-${suffix}`;
      renamed += 1;
    }
    usedBillNos.add(billNo);
    if (Number.isFinite(legacyId)) importedLegacyIds.add(legacyId);

    const customerId = text(source.customerId);
    const createdAt = sourceDate(source.createdAt) ?? new Date();
    const itemTotal = items.reduce((sum, item) => sum + number(item.total), 0);
    const itemProfit = items.reduce((sum, item) => sum + number(item.total) - number(item.cost) * number(item.quantity), 0);

    operations.push({ updateOne: { filter: { billNo }, update: { $setOnInsert: {
      billNo,
      customerId: customerIdSet.has(customerId) ? new Types.ObjectId(customerId) : null,
      customerName: text(source.customerName),
      customerPhone: text(source.customerPhone),
      customerAddress: text(source.customerAddress),
      salesmanId: new Types.ObjectId(salesmanId),
      salesmanName: text(source.salesmanName) || String(salesman.name),
      items,
      totalAmount: source.totalAmount === undefined ? itemTotal : nonNegative(source.totalAmount),
      profit: source.profit === undefined ? itemProfit : number(source.profit),
      isWalkIn: Boolean(source.isWalkIn),
      legacySource: "bestpublishers-desktop",
      legacyId: Number.isFinite(legacyId) ? legacyId : null,
      createdAt,
      updatedAt: createdAt,
    } }, upsert: true } });
  }

  let inserted = 0;
  let alreadyPresent = 0;
  if (operations.length) {
    try {
      const result = await Bill.collection.bulkWrite(operations as Parameters<typeof Bill.collection.bulkWrite>[0], { ordered: false });
      inserted = result.upsertedCount;
      alreadyPresent = result.matchedCount;
    } catch (error) {
      const writeErrors = (error as { result?: { upsertedCount?: number; matchedCount?: number } }).result;
      inserted = writeErrors?.upsertedCount ?? 0;
      alreadyPresent = writeErrors?.matchedCount ?? 0;
      if (!writeErrors) throw error;
    }
  }

  return { received: sourceBills.length, prepared: operations.length, inserted, alreadyPresent, skipped, renamed };
}

export async function POST(request: Request) {
  try {
    await connectDB();
    const body = await request.json() as Row;
    const action = text(body.action);

    if (action === "begin") {
      const state = await SyncState.findOne({ key: STATE_KEY });
      const configuredKey = text(process.env.SYNC_IMPORT_KEY);
      const providedKey = text(request.headers.get("x-sync-key"));
      const keyAccepted = Boolean(configuredKey) && providedKey === configuredKey;

      if (state?.status === "completed" && !(body.force === true && keyAccepted)) {
        return ok({ alreadyCompleted: true, completedAt: state.completedAt, stats: state.stats });
      }

      if (!keyAccepted && state?.status !== "running") {
        const [books, customers, salesmen, bills] = await Promise.all([Book.countDocuments(), Customer.countDocuments(), Salesman.countDocuments(), Bill.countDocuments()]);
        if (books + customers + salesmen + bills > 0) return fail("Initial import is locked. Set SYNC_IMPORT_KEY on the server to run it again.", 403);
      }

      const session = randomUUID();
      await SyncState.findOneAndUpdate(
        { key: STATE_KEY },
        { $set: { status: "running", session, startedAt: new Date(), completedAt: null }, $setOnInsert: { stats: {} } },
        { upsert: true },
      );
      return ok({ session, resumed: state?.status === "running" });
    }

    const state = await SyncState.findOne({ key: STATE_KEY }).lean();
    const session = text(body.session);
    if (!state || state.status !== "running" || !session || state.session !== session) return fail("Invalid or expired sync session", 401);

    if (action === "masters") return ok(await importMasters(body));
    if (action === "bills") return ok(await importBills(body));
    if (action === "complete") {
      await SyncState.updateOne({ key: STATE_KEY, session }, { $set: { status: "completed", session: null, completedAt: new Date(), stats: body.stats ?? state.stats } });
      return ok({ completed: true });
    }

    return fail("Unknown sync action");
  } catch (error) {
    return internalError(error);
  }
}
