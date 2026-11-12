import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent, createPaymentRequest, ensureDatabaseReady, generateIntegrityHash, getAgreement, getLatestPaymentRequest, saveInitialAssessment } from "@/lib/database";
import { getCurrentUser } from "@/lib/auth";

type AssessmentResponse = {
  outcome: "PROCEED" | "DISCREPANCY_IDENTIFIED" | "HUMAN_REVIEW_REQUIRED";
  explanation: string;
  requirementsConsidered: string[];
  discrepancies: string[];
  assessedAt?: string;
  escalationReason?: string | null;
};

function isAssessment(value: unknown): value is AssessmentResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ["PROCEED", "DISCREPANCY_IDENTIFIED", "HUMAN_REVIEW_REQUIRED"].includes(String(candidate.outcome)) &&
    typeof candidate.explanation === "string" &&
    Array.isArray(candidate.requirementsConsidered) && candidate.requirementsConsidered.every(item => typeof item === "string") &&
    Array.isArray(candidate.discrepancies) && candidate.discrepancies.every(item => typeof item === "string");
}

async function assessInitial(input: { agreementId:string; service:string; description:string; requirements:string; amount:number; requestedAmount:number; completionStatement:string }) {
  const apiKey=process.env.SIGNPAY_AGENT_API_KEY;
  if(!apiKey || apiKey.length<32) throw new Error("The assessment service is not configured.");
  const agentUrl=(process.env.SIGNPAY_AGENT_URL ?? "http://localhost:3200").replace(/\/+$/, "");
  const response=await fetch(`${agentUrl}/api/assess`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${apiKey}`},body:JSON.stringify({agreementReference:input.agreementId,service:input.service,agreedWork:input.description,requirements:input.requirements.trim()||"No additional specific requirements were recorded.",agreedAmount:input.amount,requestedAmount:input.requestedAmount,completionStatement:input.completionStatement,customerObjection:null}),signal:AbortSignal.timeout(60000),cache:"no-store"});
  const data=await response.json().catch(()=>null);
  if(!response.ok || !isAssessment(data)) throw new Error((typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : "The assessment service returned an invalid result."));
  return {agreementReference:input.agreementId,assessedAt:typeof data.assessedAt==="string"?data.assessedAt:new Date().toISOString(),outcome:data.outcome,explanation:data.explanation,requirementsConsidered:data.requirementsConsidered,discrepancies:data.discrepancies,escalationReason:typeof data.escalationReason==="string"?data.escalationReason:null};
}

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

    const agreement = await getAgreement(agreementId);
    if (!agreement) return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
    if (agreement.providerUserId !== user.id) return NextResponse.json({ error: "Only the authenticated service provider can submit a payment request." }, { status: 403 });
    if (agreement.status !== "active" || !agreement.signatures.provider || !agreement.signatures.customer) {
      return NextResponse.json({ error: "Both parties must sign the agreement before a payment request." }, { status: 409 });
    }
    if (!agreement.integrityHash || generateIntegrityHash(agreement) !== agreement.integrityHash) {
      return NextResponse.json({ error: "The agreement integrity check failed. Human review is required." }, { status: 409 });
    }
    const previous = await getLatestPaymentRequest(agreementId);
    if (previous && previous.status === "awaiting_customer") {
      return NextResponse.json({ error: "A payment request is already awaiting the customer's response." }, { status: 409 });
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await createPaymentRequest({
      id, agreementId, providerUserId: user.id,
      completionStatement: completionStatement.trim(),
      requestedAmount: Math.round(requestedAmount * 100) / 100,
      status: "awaiting_customer", createdAt,
    });
    await appendAuditEvent(agreementId, "assessment_submitted", "provider", {
      requestId: id, requestedAmount: Math.round(requestedAmount * 100) / 100,
      authenticatedUserId: user.id,
    });
    let initialAssessment;
    try {
      initialAssessment = await assessInitial({ agreementId: agreement.id, service: agreement.service, description: agreement.description, requirements: agreement.requirements, amount: agreement.amount, requestedAmount: Math.round(requestedAmount * 100) / 100, completionStatement: completionStatement.trim() });
    } catch (assessmentError) {
      console.error("Initial payment assessment failed:", assessmentError);
      initialAssessment = { agreementReference: agreement.id, assessedAt: new Date().toISOString(), outcome: "HUMAN_REVIEW_REQUIRED" as const, explanation: "The initial assessment could not be completed reliably. No invoice has been created.", requirementsConsidered: [], discrepancies: [], escalationReason: "The assessment service was unavailable or returned an invalid response." };
    }
    const mayInviteObjection = initialAssessment.outcome === "PROCEED";
    await saveInitialAssessment(id, initialAssessment, mayInviteObjection);
    await appendAuditEvent(agreementId, mayInviteObjection ? "initial_assessment_passed" : "initial_assessment_stopped", "system", { requestId:id, outcome:initialAssessment.outcome, assessedAt:initialAssessment.assessedAt });
    return NextResponse.json({ success: true, requestId: id, status: mayInviteObjection ? "awaiting_customer" : "completed", initialAssessment }, { status: 201 });
  } catch (error) {
    console.error("Payment request submission failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit and assess the payment request.", outcome: "HUMAN_REVIEW_REQUIRED" }, { status: 503 });
  }
}
