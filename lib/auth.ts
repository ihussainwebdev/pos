import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "pos_session";
const secret = process.env.AUTH_SECRET ?? "best-publishers-local-session-secret";

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, savedHash] = stored.split(":");
  if (!salt || !savedHash) return false;
  const attempt = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(savedHash, "hex"), Buffer.from(attempt, "hex"));
}

export function createSession(userId: string) {
  const payload = `${userId}.${Date.now() + 1000 * 60 * 60 * 24 * 7}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function isValidSession(value?: string) {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (parts[2].length !== expected.length || !timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return false;
  return Number(parts[1]) > Date.now();
}

export async function authenticated() {
  return isValidSession((await cookies()).get(SESSION_COOKIE)?.value);
}
