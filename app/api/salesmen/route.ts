import { connectDB } from "@/lib/db";
import { recordDeletion } from "@/lib/sync";
import { fail, internalError, ok, serialize } from "@/lib/api";
import Salesman from "@/models/Salesman";

const clean = (value: Record<string, unknown>) => ({ name: String(value.name ?? "").trim(), phone: String(value.phone ?? "").trim() });
export async function GET() { try { await connectDB(); return ok((await Salesman.find().sort({ name: 1 }).lean()).map(serialize)); } catch (error) { return internalError(error); } }
export async function POST(request: Request) { try { await connectDB(); const values = clean(await request.json() as Record<string, unknown>); if (!values.name) return fail("Name is required"); return ok(serialize((await Salesman.create(values)).toObject()), 201); } catch (error) { return internalError(error); } }
export async function PUT(request: Request) { try { await connectDB(); const id = new URL(request.url).searchParams.get("id"); if (!id) return fail("ID required"); const values = clean(await request.json() as Record<string, unknown>); if (!values.name) return fail("Name is required"); const salesman = await Salesman.findByIdAndUpdate(id, values, { new: true, runValidators: true }).lean(); return salesman ? ok(serialize(salesman)) : fail("Salesman not found", 404); } catch (error) { return internalError(error); } }
export async function DELETE(request: Request) { try { await connectDB(); const id = new URL(request.url).searchParams.get("id"); if (!id) return fail("ID required"); const salesman = await Salesman.findByIdAndDelete(id).lean(); if (!salesman) return fail("Salesman not found", 404); await recordDeletion("salesman", salesman._id); return ok({ id }); } catch (error) { return internalError(error); } }
