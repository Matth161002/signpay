import { NextRequest, NextResponse } from "next/server";
import {
  appendAuditEvent, completePaymentRequest, ensureDatabaseReady,
  generateIntegrityHash, getAgreement, getPaymentRequest, updatePayPalInvoice,
} from "@/lib/database";
import { getCurrentUser } from "@/lib/auth";
import { createAndSendPayPalInvoice } from "@/lib/paypal";

export async function POST(request: NextRequest) {
  let auditAgreementId: string | null = null;
  let auditRequestId: string | null = null;
  try {
    await ensureDatabaseReady();
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Please sign in before responding to a payment request." }, { status: 401 });

    const body = await request.json();
    const { requestId, customerObjection, paypalEmail } = body ?? {};
    if (typeof requestId !== "string" ||
        (customerObjection !== null && customerObjection !== undefined &&
         (typeof customerObjection !== "string" || customerObjection.length > 5000)) ||
        typeof paypalEmail !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail.trim()) ||
        paypalEmail.length > 254) {
      return NextResponse.json({ error: "Invalid customer response." }, { status: 400 });
    }

    const paymentRequest = await getPaymentRequest(requestId);
    if (!paymentRequest) return NextResponse.json({ error: "Payment request not found." }, { status: 404 });
    const agreement = await getAgreement(paymentRequest.agreementId);
    if (!agreement) return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
    if (agreement.customerUserId !== user.id) {
      return NextResponse.json({ error: "Only the authenticated customer can respond to this payment request." }, { status: 403 });
    }
    if (paymentRequest.status !== "awaiting_customer") {
      return NextResponse.json({ error: "This payment request has already been processed." }, { status: 409 });
    }
    if (!agreement.integrityHash || generateIntegrityHash(agreement) !== agreement.integrityHash) {
      return NextResponse.json({ error: "The agreement integrity check failed. Human review is required." }, { status: 409 });
    }

    auditAgreementId = agreement.id;
    auditRequestId = paymentRequest.id;
    const objection = typeof customerObjection === "string" && customerObjection.trim()
      ? customerObjection.trim() : null;

    const apiKey = process.env.SIGNPAY_AGENT_API_KEY;
    if (!apiKey || apiKey.length < 32) {
      return NextResponse.json({ error: "The assessment service is not configured." }, { status: 503 });
    }
    const agentUrl = (process.env.SIGNPAY_AGENT_URL ?? "http://localhost:3200").replace(/\/+$/, "");
    const agentResponse = await fetch(`${agentUrl}/api/assess`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        agreementReference: agreement.id,
        service: agreement.service,
        agreedWork: agreement.description,
        requirements: agreement.requirements.trim() || "No additional specific requirements were recorded.",
        agreedAmount: agreement.amount,
        requestedAmount: paymentRequest.requestedAmount,
        completionStatement: paymentRequest.completionStatement,
        customerObjection: objection,
      }),
      signal: AbortSignal.timeout(60000),
      cache: "no-store",
    });

    const agentData = await agentResponse.json().catch(() => null);
    if (!agentResponse.ok) {
      await completePaymentRequest(paymentRequest.id, objection, "failed", null);
      await appendAuditEvent(agreement.id, "assessment_failed", "system", {
        requestId: paymentRequest.id, reason: "assessment_service_error", httpStatus: agentResponse.status,
      });
      return NextResponse.json({
        error: agentData?.error ?? "The assessment service could not complete the request.",
        outcome: agentData?.outcome === "HUMAN_REVIEW_REQUIRED" ? "HUMAN_REVIEW_REQUIRED" : undefined,
      }, { status: agentResponse.status === 401 ? 502 : 503 });
    }

    const validOutcomes = ["PROCEED", "DISCREPANCY_IDENTIFIED", "HUMAN_REVIEW_REQUIRED"];
    if (!agentData || !validOutcomes.includes(agentData.outcome) ||
        typeof agentData.explanation !== "string" ||
        !Array.isArray(agentData.requirementsConsidered) ||
        !Array.isArray(agentData.discrepancies)) {
      await completePaymentRequest(paymentRequest.id, objection, "failed", null);
      await appendAuditEvent(agreement.id, "assessment_failed", "system", {
        requestId: paymentRequest.id, reason: "invalid_assessment_response",
      });
      return NextResponse.json({ error: "The assessment service returned an invalid result.", outcome: "HUMAN_REVIEW_REQUIRED" }, { status: 502 });
    }

    const assessedAt = typeof agentData.assessedAt === "string" ? agentData.assessedAt : new Date().toISOString();
    const assessment = {
      agreementReference: agreement.id, assessedAt, outcome: agentData.outcome,
      explanation: agentData.explanation,
      requirementsConsidered: agentData.requirementsConsidered,
      discrepancies: agentData.discrepancies,
      escalationReason: typeof agentData.escalationReason === "string" ? agentData.escalationReason : null,
    };
    await completePaymentRequest(paymentRequest.id, objection, "completed", assessment);

    let invoiceResult: { invoiceId: string; invoiceUrl: string | null; status: string } | null = null;
    if (agentData.outcome === "PROCEED") {
      try {
        const createdInvoice = await createAndSendPayPalInvoice({
          requestId: paymentRequest.id,
          agreementId: agreement.id,
          service: agreement.service,
          completionStatement: paymentRequest.completionStatement,
          customerName: agreement.customer,
          customerEmail: paypalEmail.trim(),
          amount: paymentRequest.requestedAmount,
        });
        invoiceResult = createdInvoice;
        await updatePayPalInvoice(paymentRequest.id, {
          recipientEmail: paypalEmail.trim(),
          invoiceId: createdInvoice.invoiceId,
          invoiceUrl: createdInvoice.invoiceUrl,
          invoiceStatus: createdInvoice.status,
          error: null,
        });
      } catch (invoiceError) {
        const message = invoiceError instanceof Error ? invoiceError.message : "PayPal invoice creation failed.";
        await updatePayPalInvoice(paymentRequest.id, {
          recipientEmail: paypalEmail.trim(), invoiceId: null, invoiceUrl: null,
          invoiceStatus: "FAILED", error: message,
        });
        await appendAuditEvent(agreement.id, "assessment_failed", "system", {
          requestId: paymentRequest.id, reason: message,
        });
        console.error("PayPal invoice creation failed after PROCEED assessment:", invoiceError);
      }
    } else {
      await updatePayPalInvoice(paymentRequest.id, {
        recipientEmail: paypalEmail.trim(), invoiceId: null, invoiceUrl: null,
        invoiceStatus: "NOT_CREATED", error: null,
      });
    }

    await appendAuditEvent(agreement.id, "assessment_completed", "system", {
      requestId: paymentRequest.id, outcome: agentData.outcome, assessedAt,
      submittedByCustomerUserId: user.id,
    });
    return NextResponse.json({ assessment, invoice: invoiceResult });
  } catch (error) {
    if (auditAgreementId && auditRequestId) {
      try {
        await completePaymentRequest(auditRequestId, null, "failed", null);
        await appendAuditEvent(auditAgreementId, "assessment_failed", "system", {
          requestId: auditRequestId, reason: "assessment_processing_error",
        });
      } catch (auditError) {
        console.error("Unable to record assessment failure:", auditError);
      }
    }
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error("Payment assessment failed:", error);
    return NextResponse.json({
      error: timedOut ? "The assessment service timed out. Human review is required." : "Unable to process the payment assessment.",
      outcome: "HUMAN_REVIEW_REQUIRED",
    }, { status: 503 });
  }
}
