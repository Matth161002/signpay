import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  Agreement, appendAuditEvent, createAgreement, ensureDatabaseReady,
  generateIntegrityHash, getAgreement, getAgreementsForUser, getLatestPaymentRequest, getUserByUsername, saveAgreement,
} from "@/lib/database";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseReady();
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Please sign in to access agreements." }, { status: 401 });

    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ agreements: getAgreementsForUser(user.id) });

    const agreement = getAgreement(id);
    if (!agreement) return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
    if (agreement.providerUserId !== user.id && agreement.customerUserId !== user.id) {
      return NextResponse.json({ error: "You do not have access to this agreement." }, { status: 403 });
    }
    return NextResponse.json({ agreement, paymentRequest: getLatestPaymentRequest(id) });
  } catch (error) {
    console.error("Agreement retrieval failed:", error);
    return NextResponse.json({ error: "Unable to retrieve agreement." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseReady();
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Please sign in before continuing." }, { status: 401 });

    const body = await request.json();

    if (body.action === "create") {
      const { role, counterpartyUsername, service, description, requirements, amount } = body;
      if ((role !== "provider" && role !== "customer") ||
          typeof counterpartyUsername !== "string" || !counterpartyUsername.trim() ||
          typeof service !== "string" || !service.trim() ||
          typeof description !== "string" || !description.trim() ||
          typeof requirements !== "string" ||
          typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: "Please provide valid agreement details and the other party's username." }, { status: 400 });
      }

      const other = getUserByUsername(counterpartyUsername.trim().toLowerCase());
      if (!other) return NextResponse.json({ error: "No account was found for that username. Ask the other party to register first." }, { status: 404 });
      if (other.id === user.id) return NextResponse.json({ error: "An agreement must involve two different accounts." }, { status: 400 });

      const providerUserId = role === "provider" ? user.id : other.id;
      const customerUserId = role === "customer" ? user.id : other.id;
      const provider = role === "provider" ? user.displayName : other.displayName;
      const customer = role === "customer" ? user.displayName : other.displayName;

      const agreement: Agreement = {
        id: randomUUID(), provider, customer, providerUserId, customerUserId,
        service: service.trim(), description: description.trim(),
        requirements: requirements.trim(), amount: Math.round(amount * 100) / 100,
        createdAt: new Date().toISOString(),
        signatures: { provider: null, customer: null },
        status: "awaiting_signatures", integrityHash: null,
      };
      createAgreement(agreement);
      appendAuditEvent(agreement.id, "agreement_created", "system", {
        service: agreement.service, agreedAmount: agreement.amount,
        providerUserId, customerUserId, createdByUserId: user.id,
      });
      return NextResponse.json({ agreement }, { status: 201 });
    }

    if (body.action === "sign") {
      const { id, signature } = body;
      if (typeof id !== "string" || typeof signature !== "string" ||
          !signature.startsWith("data:image/png;base64,") || signature.length > 500000) {
        return NextResponse.json({ error: "Invalid signature information." }, { status: 400 });
      }
      const agreement = getAgreement(id);
      if (!agreement) return NextResponse.json({ error: "Agreement not found." }, { status: 404 });

      const role = agreement.providerUserId === user.id ? "provider"
        : agreement.customerUserId === user.id ? "customer" : null;
      if (!role) return NextResponse.json({ error: "You are not a participant in this agreement." }, { status: 403 });
      if (agreement.status === "active") return NextResponse.json({ error: "This agreement is already active and cannot be changed." }, { status: 409 });
      if (agreement.signatures[role]) return NextResponse.json({ error: "Your account has already signed this agreement." }, { status: 409 });

      const signedAt = new Date().toISOString();
      agreement.signatures[role] = { signature, signedAt };
      saveAgreement(agreement);
      appendAuditEvent(agreement.id, role === "provider" ? "provider_signed" : "customer_signed", role, {
        signedAt, authenticatedUserId: user.id,
      });

      if (agreement.signatures.provider && agreement.signatures.customer) {
        agreement.status = "active";
        agreement.integrityHash = generateIntegrityHash(agreement);
        saveAgreement(agreement);
        appendAuditEvent(agreement.id, "agreement_activated", "system", {
          integrityHash: agreement.integrityHash,
        });
      }
      return NextResponse.json({ agreement });
    }

    return NextResponse.json({ error: "Unknown agreement action." }, { status: 400 });
  } catch (error) {
    console.error("Agreement processing failed:", error);
    return NextResponse.json({ error: "The agreement could not be processed." }, { status: 500 });
  }
}
