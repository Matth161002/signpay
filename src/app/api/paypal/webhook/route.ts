import { NextRequest, NextResponse } from "next/server";
import { ensureDatabaseReady, recordPaidPayPalWebhook } from "@/lib/database";
import { verifyPayPalWebhookSignature } from "@/lib/paypal";


export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseReady();
    const transmissionId = request.headers.get("paypal-transmission-id");
    const transmissionTime = request.headers.get("paypal-transmission-time");
    const transmissionSignature = request.headers.get("paypal-transmission-sig");
    const certUrl = request.headers.get("paypal-cert-url");
    const authAlgorithm = request.headers.get("paypal-auth-algo");

    if (!transmissionId || !transmissionTime || !transmissionSignature || !certUrl || !authAlgorithm) {
      return NextResponse.json({ error: "Missing PayPal signature headers." }, { status: 400 });
    }

    const event = await request.json().catch(() => null);
    if (!event || typeof event !== "object" || typeof event.id !== "string" ||
        typeof event.event_type !== "string" || !event.resource || typeof event.resource !== "object") {
      return NextResponse.json({ error: "Invalid PayPal webhook event." }, { status: 400 });
    }

    const verified = await verifyPayPalWebhookSignature({
      transmissionId, transmissionTime, transmissionSignature, certUrl, authAlgorithm,
      webhookEvent: event as Record<string, unknown>,
    });
    if (!verified) {
      return NextResponse.json({ error: "PayPal webhook signature was not valid." }, { status: 400 });
    }

    // Only a verified invoice-paid event can mark a SignPay invoice as paid.
    if (event.event_type === "INVOICING.INVOICE.PAID") {
      const resource = event.resource as Record<string, unknown>;
      const invoice = resource.invoice && typeof resource.invoice === "object"
        ? resource.invoice as Record<string, unknown>
        : null;
      // PayPal's INVOICING.INVOICE.PAID event nests the invoice under resource.invoice.
      // Keep resource.id as a compatibility fallback for alternate event shapes.
      const invoiceId = typeof invoice?.id === "string"
        ? invoice.id
        : typeof resource.id === "string" ? resource.id : null;
      if (!invoiceId) {
        console.error("Verified PayPal invoice-paid event has no invoice ID.", {
          eventId: event.id,
          resourceKeys: Object.keys(resource),
        });
        return NextResponse.json({ error: "Paid event did not contain an invoice ID." }, { status: 400 });
      }

      console.info("Processing verified PayPal invoice-paid event.", {
        eventId: event.id,
        invoiceId,
        invoiceStatus: typeof invoice?.status === "string" ? invoice.status : "unknown",
      });

      const result = await recordPaidPayPalWebhook({
        eventId: event.id as string,
        eventType: event.event_type as string,
        invoiceId,
        payload: event as Record<string, unknown>,
      });
      console.info("PayPal paid-invoice webhook database result:", { eventId: event.id, invoiceId, result });
      if (result === "unmatched") {
        return NextResponse.json({ error: "PayPal invoice does not match a SignPay payment request." }, { status: 500 });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("PayPal webhook processing failed:", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
