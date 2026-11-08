import { timingSafeEqual } from "crypto";
import type { ClientSession } from "mongoose";
import { fail } from "@/lib/api";
import Bill from "@/models/Bill";
import Book from "@/models/Book";
import Customer from "@/models/Customer";
import Salesman from "@/models/Salesman";
import SyncState from "@/models/SyncState";
import Tombstone from "@/models/Tombstone";

export type SyncEntity = "book" | "customer" | "salesman" | "bill";

export function rejectSyncRequest(request: Request) {
  const configured = String(process.env.SYNC_API_KEY ?? "").trim();
  if (!configured) return fail("Sync is not configured on the server", 503);
  const provided = Buffer.from(String(request.headers.get("x-sync-key") ?? "").trim());
  const expected = Buffer.from(configured);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return fail("Unauthorized", 401);
  return null;
}

// Changes when Atlas is re-seeded, so desktops re-link their local rows instead of trusting stale ids.
export async function currentEpoch() {
  const state = await SyncState.collection.findOne({ key: "initialImport" });
  if (!state || state.status !== "completed") return null;
  const counts = await Promise.all([Book, Customer, Salesman, Bill].map((model) => model.collection.estimatedDocumentCount()));
  if (counts.every((count) => count === 0)) return null;
  const completedAt = state.completedAt ? new Date(state.completedAt).getTime() : 0;
  return `${state._id.toString()}:${completedAt}`;
}

export async function recordDeletion(entity: SyncEntity, remoteId: string | { toString(): string }, session?: ClientSession) {
  const now = new Date();
  await Tombstone.collection.insertOne({ entity, remoteId: String(remoteId), deletedAt: now, createdAt: now, updatedAt: now }, session ? { session } : {});
}
