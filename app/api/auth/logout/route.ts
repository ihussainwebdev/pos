import { SESSION_COOKIE } from "@/lib/auth";
import { ok } from "@/lib/api";

export async function POST() {
  const response = ok({ message: "Logged out" });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
