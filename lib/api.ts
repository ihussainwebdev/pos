import { NextResponse } from "next/server";

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data, error: null }, { status });
}

export function fail(error: unknown, status = 400) {
  return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : String(error) }, { status });
}

export function internalError(error: unknown) {
  console.error("API request failed", error);
  return fail("Internal server error", 500);
}

export function serialize<T extends { _id: { toString(): string } }>(value: T) {
  return { ...value, _id: value._id.toString() };
}
