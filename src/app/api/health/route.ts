import { NextResponse } from "next/server";
import { ensureDatabaseReady } from "@/lib/database";

export async function GET(request: Request) {
  void request.headers;
  try {
    await ensureDatabaseReady();
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json({ status: "error", database: "unavailable" }, { status: 503 });
  }
}
