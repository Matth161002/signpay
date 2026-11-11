import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent, createPaymentRequest, ensureDatabaseReady, generateIntegrityHash, getAgreement, getLatestPaymentRequest } from "@/lib/database";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseReady();
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Please sign in before submitting a payment request." }, { status: 401 });

    const body = await request.json();
    const { agreementId, completionStatement, requestedAmount } = body ?? {};
    if (typeof agreementId !== "string" || typeof completionStatement !== "string" ||
        !completionStatement.trim() || completionStatement.length > 5000 ||
        typeof requestedAmount !== "number" || !Number.isFinite(requestedAmount) || requestedAmount < 0) {
      return NextResponse.json({ error: "Please provide a completion statement and valid requested amount." }, { status: 400 });
    }

    const agreement = getAgreement(agreementId);
    if (!agreement) return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
    if (agreement.providerUserId !== user.id) return NextResponse.json({ error: "Only the authenticated service provider can submit a payment request." }, { status: 403 });
    if (agreement.status !== "active" || !agreement.signatures.provider || !agreement.signatures.customer) {
      return NextResponse.json({ error: "Both parties must sign the agreement before a payment request." }, { status: 409 });
    }
    if (!agreement.integrityHash || generateIntegrityHash(agreement) !== agreement.integrityHash) {
      return NextResponse.json({ error: "The agreement integrity check failed. Human review is required." }, { status: 409 });
    }
    const previous = getLatestPaymentRequest(agreementId);
    if (previous && previous.status === "awaiting_customer") {
      return NextResponse.json({ error: "A payment request is already awaiting the customer's response." }, { status: 409 });
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    createPaymentRequest({
      id, agreementId, providerUserId: user.id,
      completionStatement: completionStatement.trim(),
      requestedAmount: Math.round(requestedAmount * 100) / 100,
      status: "awaiting_customer", createdAt,
    });
    appendAuditEvent(agreementId, "assessment_submitted", "provider", {
      requestId: id, requestedAmount: Math.round(requestedAmount * 100) / 100,
      authenticatedUserId: user.id,
    });
    return NextResponse.json({ success: true, requestId: id, status: "awaiting_customer" }, { status: 201 });
  } catch (error) {
    console.error("Payment request submission failed:", error);
    return NextResponse.json({ error: "Unable to submit the payment request." }, { status: 500 });
  }
}
