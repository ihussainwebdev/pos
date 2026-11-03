import { connectDB } from "@/lib/db";
import { createSession, hashPassword, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { fail, internalError, ok } from "@/lib/api";
import Admin from "@/models/Admin";

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json() as { username?: string; password?: string };
    if (!username?.trim() || !password) return fail("Username and password are required");
    await connectDB();
    const normalized = username.trim().toLowerCase();
    let admin = await Admin.findOne({ username: normalized });
    if (!admin && normalized === "admin" && password === "adminbest") admin = await Admin.create({ username: "admin", passwordHash: hashPassword("adminbest") });
    if (!admin || !verifyPassword(password, admin.passwordHash)) return fail("Invalid username or password", 401);
    const response = ok({ username: admin.username });
    response.cookies.set(SESSION_COOKIE, createSession(admin._id.toString()), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 });
    return response;
  } catch (error) { return internalError(error); }
}
