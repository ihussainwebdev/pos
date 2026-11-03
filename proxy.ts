import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/auth")) return NextResponse.next();
  if (isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  return NextResponse.json({ success: false, data: null, error: "Unauthorized" }, { status: 401 });
}

export const config = { matcher: ["/api/:path*"] };
