import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseReady, getUserByUsername } from "@/lib/database";
import { createLoginSession, setSessionCookie, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseReady();
    const body = await request.json();
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = getUserByUsername(username);

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    const token = createLoginSession(user.id);
    await setSessionCookie(token);
    return NextResponse.json({ user: { id: user.id, username: user.username, displayName: user.displayName } });
  } catch (error) {
    console.error("Login failed:", error);
    return NextResponse.json({ error: "Unable to sign in." }, { status: 500 });
  }
}
