import { mongo, Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { internalError, ok } from "@/lib/api";
import { currentEpoch, rejectSyncRequest } from "@/lib/sync";
import Bill from "@/models/Bill";
import Book from "@/models/Book";
import Customer from "@/models/Customer";
import Salesman from "@/models/Salesman";
import Tombstone from "@/models/Tombstone";

type Cursor = { t?: string | null; id?: string | null } | null;
type Document = mongo.Document;
type Collection = mongo.Collection<Document>;
const ObjectId = Types.ObjectId;

const SOURCES = {
  books: { collection: () => Book.collection as unknown as Collection, limit: 1000 },
  customers: { collection: () => Customer.collection as unknown as Collection, limit: 1000 },
  salesmen: { collection: () => Salesman.collection as unknown as Collection, limit: 1000 },
  bills: { collection: () => Bill.collection as unknown as Collection, limit: 250 },
  tombstones: { collection: () => Tombstone.collection as unknown as Collection, limit: 1000 },
} as const;

function afterCursor(cursor: Cursor): mongo.Filter<Document> {
  if (!cursor?.t) return {};
  const t = new Date(cursor.t);
  if (Number.isNaN(t.getTime())) return {};
  if (cursor.id && ObjectId.isValid(cursor.id)) return { $or: [{ updatedAt: { $gt: t } }, { updatedAt: t, _id: { $gt: new ObjectId(cursor.id) } }] };
  return { updatedAt: { $gte: t } };
}

export async function POST(request: Request) {
  const denied = rejectSyncRequest(request);
  if (denied) return denied;
  try {
    await connectDB();
    const body = await request.json().catch(() => ({})) as { epoch?: string | null; cursors?: Record<string, Cursor> };
    const serverTime = new Date().toISOString();
    const epoch = await currentEpoch();
    if (!epoch) return ok({ epoch: null, serverTime });
    if (body.epoch !== epoch) return ok({ epoch, serverTime, reset: true });

    const data: Record<string, Document[]> = {};
    const cursors: Record<string, Cursor> = {};
    let hasMore = false;
    await Promise.all(Object.entries(SOURCES).map(async ([name, source]) => {
      const rows = await source.collection().find(afterCursor(body.cursors?.[name] ?? null)).sort({ updatedAt: 1, _id: 1 }).limit(source.limit + 1).toArray();
      if (rows.length > source.limit) { rows.length = source.limit; hasMore = true; }
      data[name] = rows;
      const last = rows[rows.length - 1];
      cursors[name] = last ? { t: last.updatedAt ? new Date(last.updatedAt).toISOString() : new Date(0).toISOString(), id: last._id.toString() } : null;
    }));

    return ok({ epoch, serverTime, data, cursors, hasMore });
  } catch (error) {
    return internalError(error);
  }
}
