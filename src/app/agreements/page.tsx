"use client";

import { useEffect, useState } from "react";

type Agreement = { id: string; provider: string; customer: string; providerUserId: string | null; customerUserId: string | null; service: string; amount: number; createdAt: string; status: "awaiting_signatures" | "active"; signatures: { provider: unknown; customer: unknown } ; paypalInvoiceStatus?: string | null };
type User = { id: string; username: string; displayName: string };

export default function AgreementsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const session = await fetch("/api/auth/session", { cache: "no-store" });
        const sessionData = await session.json();
        if (!sessionData.user) { window.location.href = "/agreement"; return; }
        setUser(sessionData.user);
        const response = await fetch("/api/agreements", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load agreements.");
        const listed: Agreement[] = data.agreements || [];
        const withPaymentStatus = await Promise.all(listed.map(async agreement => {
          try {
            const detailResponse = await fetch(`/api/agreements?id=${encodeURIComponent(agreement.id)}`, { cache: "no-store" });
            const detail = await detailResponse.json();
            return { ...agreement, paypalInvoiceStatus: detailResponse.ok ? detail.paymentRequest?.paypalInvoiceStatus ?? null : null };
          } catch {
            return { ...agreement, paypalInvoiceStatus: null };
          }
        }));
        setAgreements(withPaymentStatus);
      } catch (e) { setError(e instanceof Error ? e.message : "Unable to load agreements."); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  async function copyReference(id: string) {
    try { await navigator.clipboard.writeText(id); setCopied(id); }
    catch { setError("Could not copy the reference. Select and copy it manually."); }
  }

  return <main className="min-h-screen bg-slate-950 px-6 py-12 text-white"><div className="mx-auto max-w-4xl">
    <div className="flex flex-wrap items-center justify-between gap-3"><a href="/agreement" className="text-sm text-blue-400 hover:text-blue-300">Back to SignPay</a><span className="text-sm text-slate-400">{user ? `${user.displayName} (@${user.username})` : ""}</span></div>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-bold">My agreements</h1><a href="/agreement" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">Create agreement</a></div>
    <p className="mt-2 text-slate-400">All agreements associated with your account. Open any agreement to review it or continue signing.</p>
    {error && <p className="mt-5 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
    {loading ? <p className="mt-8 text-slate-400">Loading agreements...</p> : agreements.length === 0 ? <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6"><p>You do not have any agreements yet.</p></section> : <div className="mt-8 space-y-4">{agreements.map(a => <section key={a.id} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{a.service}</h2><p className="mt-1 text-sm text-slate-400">{a.provider} <span className="text-slate-600">and</span> {a.customer}</p></div><span className="rounded-full bg-slate-800 px-3 py-1 text-xs">{a.paypalInvoiceStatus === "PAID" ? "Completed" : a.status === "active" ? "Active" : "Awaiting signatures"}</span></div>
      <div className="mt-4"><p className="text-xs text-slate-400">Agreement reference</p><div className="mt-1 flex flex-wrap items-center gap-3"><code className="break-all text-sm">{a.id}</code><button onClick={() => copyReference(a.id)} className="rounded-lg border border-slate-600 px-3 py-1 text-xs hover:bg-slate-800">{copied === a.id ? "Copied" : "Copy reference"}</button></div></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-300">£{a.amount.toFixed(2)} <span className="text-slate-500">· Created {new Date(a.createdAt).toLocaleDateString("en-GB")}</span></p><a href={`/agreement?id=${encodeURIComponent(a.id)}`} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">Open agreement</a></div>
    </section>)}</div>}
  </div></main>;
}
