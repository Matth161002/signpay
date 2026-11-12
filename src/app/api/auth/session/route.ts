import { NextResponse } from "next/server";
import { ensureDatabaseReady } from "@/lib/database";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabaseReady();
    return NextResponse.json({ user: await getCurrentUser() });
  } catch (error) {
    console.error("Session lookup failed:", error);
    return NextResponse.json(
      { error: "Unable to check the current session." },
      { status: 500 }
    );
  }
}
