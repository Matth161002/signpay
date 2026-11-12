import { NextResponse } from "next/server";
import { ensureDatabaseReady } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabaseReady();
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json({ status: "error", database: "unavailable" }, { status: 503 });
  }
}
