import { authenticated } from "@/lib/auth";
import { ok } from "@/lib/api";

export async function GET() { return ok({ authenticated: await authenticated() }); }
