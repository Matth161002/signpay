import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createUser, ensureDatabaseReady, getUserByUsername } from "@/lib/database";
import { createLoginSession, hashPassword, setSessionCookie } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseReady();
    const body = await request.json();
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return NextResponse.json({ error: "Username must be 3 to 24 characters using letters, numbers or underscores." }, { status: 400 });
    }
    if (displayName.length < 2 || displayName.length > 60) {
      return NextResponse.json({ error: "Display name must be between 2 and 60 characters." }, { status: 400 });
    }
    if (password.length < 12 || password.length > 128) {
      return NextResponse.json({ error: "Password must be at least 12 characters and no more than 128 characters." }, { status: 400 });
    }
    if (getUserByUsername(username)) {
      return NextResponse.json({ error: "That username is already registered." }, { status: 409 });
    }

    const userId = randomUUID();
    createUser({
      id: userId, username, displayName,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    });
    const token = createLoginSession(userId);
    await setSessionCookie(token);
    return NextResponse.json({ user: { id: userId, username, displayName } }, { status: 201 });
  } catch (error) {
    console.error("Registration failed:", error);
    return NextResponse.json({ error: "Unable to create the account." }, { status: 500 });
  }
}
