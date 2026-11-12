"use client";

import Link from "next/link";
import { FormEvent, PointerEvent, useEffect, useRef, useState } from "react";

type User = { id: string; username: string; displayName: string };
type SignatureRecord = { signature: string; signedAt: string };
type Agreement = {
  id: string; provider: string; customer: string;
  providerUserId: string | null; customerUserId: string | null;
  service: string; description: string; requirements: string; amount: number;
  createdAt: string;
  signatures: { provider: SignatureRecord | null; customer: SignatureRecord | null };
  status: "awaiting_signatures" | "active"; integrityHash: string | null;
};
type PaymentRequest = {
  id: string; agreementId: string; completionStatement: string;
  requestedAmount: number; customerObjection: string | null;
  status: "awaiting_customer" | "completed" | "failed";
  initialAssessmentJson: string | null; assessmentJson: string | null; paypalRecipientEmail: string | null;
  paypalInvoiceId: string | null; paypalInvoiceUrl: string | null;
  paypalInvoiceStatus: string | null; paypalError: string | null;
  createdAt: string; updatedAt: string;
};
type Assessment = {
  agreementReference: string; assessedAt: string;
  outcome: "PROCEED" | "DISCREPANCY_IDENTIFIED" | "HUMAN_REVIEW_REQUIRED";
  explanation: string; requirementsConsidered: string[];
  discrepancies: string[]; escalationReason: string | null;
};

export default function AgreementPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [role, setRole] = useState<"provider" | "customer">("provider");
  const [counterpartyUsername, setCounterpartyUsername] = useState("");
  const [service, setService] = useState("");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [amount, setAmount] = useState("");
  const [completionStatement, setCompletionStatement] = useState("");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [customerObjection, setCustomerObjection] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  async function refreshAgreement(id: string) {
    const response = await fetch(`/api/agreements?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load agreement.");
    setAgreement(data.agreement);
    setPaymentRequest(data.paymentRequest ?? null);
  }

  useEffect(() => {
    async function initialise() {
      try {
        const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
        const sessionData = await sessionResponse.json();
        if (sessionData.user) {
          setUser(sessionData.user);
          const id = new URLSearchParams(window.location.search).get("id");
          if (id) await refreshAgreement(id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to initialise SignPay.");
      }
    }
    initialise();
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Authentication failed.");
      setUser(data.user); setPassword(""); setNotice("You are signed in.");
      const id = new URLSearchParams(window.location.search).get("id");
      if (id) await refreshAgreement(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally { setLoading(false); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null); setAgreement(null); setPaymentRequest(null);
    window.history.replaceState(null, "", "/agreement");
    setNotice("You have signed out.");
  }

  async function createAgreement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/agreements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create", role, counterpartyUsername, service, description,
          requirements, amount: Number(amount),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create agreement.");
      setAgreement(data.agreement); setPaymentRequest(null);
      window.history.replaceState(null, "", `/agreement?id=${data.agreement.id}`);
      setNotice("Agreement created. The other party can now sign in and open the agreement using its reference.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create agreement.");
    } finally { setLoading(false); }
  }

  function getCanvasContext() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    return canvas && context ? { canvas, context } : null;
  }
  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const drawing = getCanvasContext(); if (!drawing) return;
    const { canvas, context } = drawing; const bounds = canvas.getBoundingClientRect();
    drawingRef.current = true; canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo((event.clientX - bounds.left) * (canvas.width / bounds.width),
      (event.clientY - bounds.top) * (canvas.height / bounds.height));
    context.strokeStyle = "#111827"; context.lineWidth = 3; context.lineCap = "round"; context.lineJoin = "round";
  }
  function continueDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const drawing = getCanvasContext(); if (!drawing) return;
    const { canvas, context } = drawing; const bounds = canvas.getBoundingClientRect();
    context.lineTo((event.clientX - bounds.left) * (canvas.width / bounds.width),
      (event.clientY - bounds.top) * (canvas.height / bounds.height));
    context.stroke();
  }
  function clearSignature() {
    const drawing = getCanvasContext();
    if (drawing) drawing.context.clearRect(0, 0, drawing.canvas.width, drawing.canvas.height);
  }

  async function signAgreement() {
    if (!agreement || !canvasRef.current) return;
    const canvas = canvasRef.current; const context = canvas.getContext("2d");
    if (!context) return;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hasInk = false;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) { hasInk = true; break; }
    if (!hasInk) { setError("Please draw your signature before submitting."); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/agreements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sign", id: agreement.id, signature: canvas.toDataURL("image/png") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to record signature.");
      setAgreement(data.agreement); clearSignature();
      setNotice("Your signature has been recorded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record signature.");
    } finally { setLoading(false); }
  }

  async function submitPaymentRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!agreement) return;
    setAssessmentLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/payment-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreementId: agreement.id, completionStatement, requestedAmount: Number(requestedAmount) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to submit payment request.");
      await refreshAgreement(agreement.id);
      setNotice("The initial AI assessment has completed. The customer can now review the result.");
      setCompletionStatement(""); setRequestedAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit payment request.");
    } finally { setAssessmentLoading(false); }
  }

  async function respondToPaymentRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!paymentRequest || !agreement) return;
    setAssessmentLoading(true); setError("");
    try {
      const response = await fetch("/api/assessments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: paymentRequest.id, customerObjection: customerObjection.trim() || null, paypalEmail }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to assess this payment request.");
      await refreshAgreement(agreement.id);
      setNotice("The assessment has been completed and recorded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to assess this payment request.");
    } finally { setAssessmentLoading(false); }
  }

  const myRole = agreement && user
    ? agreement.providerUserId === user.id ? "provider"
      : agreement.customerUserId === user.id ? "customer" : null
    : null;
  const signed = myRole && agreement ? agreement.signatures[myRole] !== null : false;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">Back to SignPay</Link>
          {user && <Link href="/agreements" className="text-sm text-blue-400 hover:text-blue-300">My agreements</Link>}
        </div>
        <div className="mt-6 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">SignPay</h1>
          {user && <div className="text-right">
            <p className="text-sm text-slate-300">{user.displayName} (@{user.username})</p>
            <button onClick={logout} className="mt-1 text-sm text-blue-400 hover:text-blue-300">Sign out</button>
          </div>}
        </div>

        {!user ? (
          <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">{authMode === "register" ? "Create your account" : "Sign in"}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Each agreement participant needs their own SignPay account. Use a username you can share with the other party.
            </p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setAuthMode("register")} className={`rounded-lg px-4 py-2 text-sm ${authMode === "register" ? "bg-blue-600" : "bg-slate-800"}`}>Register</button>
              <button onClick={() => setAuthMode("login")} className={`rounded-lg px-4 py-2 text-sm ${authMode === "login" ? "bg-blue-600" : "bg-slate-800"}`}>Sign in</button>
            </div>
            <form onSubmit={submitAuth} className="mt-6 space-y-4">
              {authMode === "register" && <div>
                <label className="mb-2 block text-sm text-slate-300">Display name</label>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} required className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
              </div>}
              <div>
                <label className="mb-2 block text-sm text-slate-300">Username</label>
                <input value={username} onChange={e => setUsername(e.target.value)} minLength={3} maxLength={24} required className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={authMode === "register" ? 12 : 1} maxLength={128} required className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                {authMode === "register" && <p className="mt-1 text-xs text-slate-500">At least 12 characters.</p>}
              </div>
              <button disabled={loading} className="w-full rounded-lg bg-blue-600 px-5 py-3 font-semibold disabled:opacity-50">{loading ? "Please wait..." : authMode === "register" ? "Create account" : "Sign in"}</button>
            </form>
          </section>
        ) : !agreement ? (
          <>
            <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-xl font-semibold">Open an existing agreement</h2>
              <p className="mt-2 text-sm text-slate-400">Enter the agreement reference supplied by the other participant.</p>
              <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={async e => {
                e.preventDefault(); const form = e.currentTarget;
                const id = String(new FormData(form).get("agreementId") || "").trim();
                setLoading(true); setError("");
                try { await refreshAgreement(id); window.history.replaceState(null, "", `/agreement?id=${id}`); }
                catch (err) { setError(err instanceof Error ? err.message : "Unable to open agreement."); }
                finally { setLoading(false); }
              }}>
                <input name="agreementId" required className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-3" />
                <button disabled={loading} className="rounded-lg bg-slate-700 px-5 py-3 font-semibold">Open agreement</button>
              </form>
            </section>
            <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-xl font-semibold">Create an agreement</h2>
              <form onSubmit={createAgreement} className="mt-5 space-y-5">
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Your role in this agreement</label>
                  <select value={role} onChange={e => setRole(e.target.value as "provider" | "customer")} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3">
                    <option value="provider">I am the service provider</option>
                    <option value="customer">I am the customer</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Other participant&apos;s username</label>
                  <input value={counterpartyUsername} onChange={e => setCounterpartyUsername(e.target.value)} required className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Service title</label>
                  <input value={service} onChange={e => setService(e.target.value)} required className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Description of the agreed work</label>
                  <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} required className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Specific requirements</label>
                  <textarea value={requirements} onChange={e => setRequirements(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Agreed payment amount (£)</label>
                  <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                </div>
                <button disabled={loading} className="w-full rounded-lg bg-blue-600 px-5 py-3 font-semibold disabled:opacity-50">{loading ? "Creating..." : "Create agreement"}</button>
              </form>
            </section>
          </>
        ) : (
          <>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold">Agreement review</h2>
              <span className="rounded-full bg-slate-800 px-4 py-2 text-sm">{paymentRequest?.paypalInvoiceStatus === "PAID" ? "Completed" : agreement.status === "active" ? "Active" : "Awaiting signatures"}</span>
            </div>
            <section className="mt-6 space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
              <div><p className="text-xs text-slate-400">Agreement reference</p><div className="mt-1 flex flex-wrap items-center gap-3"><p className="break-all font-mono text-sm">{agreement.id}</p><button type="button" onClick={() => navigator.clipboard.writeText(agreement.id)} className="rounded-lg border border-slate-600 px-3 py-1 text-xs hover:bg-slate-800">Copy reference</button></div></div>
              <div><p className="text-sm text-slate-400">Service</p><p className="text-xl font-semibold">{agreement.service}</p></div>
              <div><p className="text-sm text-slate-400">Provider</p><p>{agreement.provider}</p></div>
              <div><p className="text-sm text-slate-400">Customer</p><p>{agreement.customer}</p></div>
              <div><p className="text-sm text-slate-400">Agreed work</p><p className="whitespace-pre-wrap">{agreement.description}</p></div>
              <div><p className="text-sm text-slate-400">Requirements</p><p className="whitespace-pre-wrap">{agreement.requirements || "None specified"}</p></div>
              <div><p className="text-sm text-slate-400">Agreed payment</p><p className="text-2xl font-bold">£{agreement.amount.toFixed(2)}</p></div>
            </section>

            <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="text-lg font-semibold">Signature records</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {(["provider", "customer"] as const).map(r => {
                  const record = agreement.signatures[r];
                  const name = r === "provider" ? agreement.provider : agreement.customer;
                  return <div key={r} className="rounded-lg border border-slate-700 p-4">
                    <p className="font-semibold">{name}</p><p className="text-sm text-slate-400">{r === "provider" ? "Service provider" : "Customer"}</p>
                    {record ? <><img src={record.signature} alt={`${name}'s signature`} className="mt-3 h-20 w-full rounded bg-white object-contain" /><p className="mt-2 text-xs text-green-400">Signed: {new Date(record.signedAt).toLocaleString()}</p></> : <p className="mt-4 text-sm text-amber-400">Awaiting signature</p>}
                  </div>;
                })}
              </div>
            </section>

            {agreement.status !== "active" && !signed && myRole && (
              <section className="mt-6 rounded-xl border border-blue-900 bg-blue-950/30 p-6">
                <h3 className="text-lg font-semibold">Sign as {myRole}</h3>
                <p className="mt-2 text-sm text-slate-400">Your account is authorised to sign only in its assigned role.</p>
                <div className="mt-4 overflow-hidden rounded-lg bg-white">
                  <canvas ref={canvasRef} width={700} height={200} onPointerDown={startDrawing} onPointerMove={continueDrawing} onPointerUp={() => drawingRef.current = false} onPointerCancel={() => drawingRef.current = false} className="h-40 w-full touch-none" />
                </div>
                <div className="mt-3 flex gap-3">
                  <button onClick={clearSignature} className="rounded-lg border border-slate-600 px-4 py-2 text-sm">Clear</button>
                  <button onClick={signAgreement} disabled={loading} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold disabled:opacity-50">{loading ? "Recording..." : "Submit signature"}</button>
                </div>
              </section>
            )}
            {agreement.status !== "active" && signed && <p className="mt-6 text-sm text-green-400">Your signature is recorded. The other participant must sign to activate the agreement.</p>}
            {agreement.status === "active" && (
              <section className="mt-6 rounded-xl border border-green-900 bg-green-950/20 p-6">
                <h3 className="text-lg font-semibold text-green-300">{paymentRequest?.paypalInvoiceStatus === "PAID" ? "Agreement completed" : "Agreement active"}</h3>
                <p className="mt-2 text-sm text-slate-300">{paymentRequest?.paypalInvoiceStatus === "PAID" ? "Both participants signed the agreement and PayPal has confirmed that the payment was completed." : "Both authenticated participants have signed. The agreement is locked and awaiting completion of the agreed service and payment."}</p>
                <details className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <summary className="cursor-pointer text-sm">Technical details</summary>
                  <p className="mt-3 text-xs text-slate-400">Agreement integrity hash</p>
                  <p className="mt-2 break-all font-mono text-xs text-green-300">{agreement.integrityHash}</p>
                </details>
              </section>
            )}

            {agreement.status === "active" && myRole === "provider" && (
              <section className="mt-6 rounded-xl border border-blue-900 bg-blue-950/20 p-6">
                <h3 className="text-lg font-semibold">Submit payment request</h3>
                {paymentRequest?.status === "awaiting_customer" ? <p className="mt-3 text-sm text-amber-300">Your payment request is awaiting the customer&apos;s response.</p> : (
                  <form onSubmit={submitPaymentRequest} className="mt-4 space-y-4">
                    <div><label className="mb-2 block text-sm text-slate-300">Completion statement</label><textarea value={completionStatement} onChange={e => setCompletionStatement(e.target.value)} rows={4} maxLength={5000} required className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" /></div>
                    <div><label className="mb-2 block text-sm text-slate-300">Requested payment amount (£)</label><input type="number" min="0" step="0.01" value={requestedAmount} onChange={e => setRequestedAmount(e.target.value)} required className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" /><p className="mt-1 text-xs text-slate-500">Agreed amount: £{agreement.amount.toFixed(2)}</p></div>
                    <button disabled={assessmentLoading} className="w-full rounded-lg bg-blue-600 px-5 py-3 font-semibold disabled:opacity-50">{assessmentLoading ? "Submitting..." : "Send to customer"}</button>
                  </form>
                )}
              </section>
            )}

            {agreement.status === "active" && myRole === "customer" && paymentRequest?.status === "awaiting_customer" && paymentRequest.initialAssessmentJson && (
              <section className="mt-6 rounded-xl border border-amber-900 bg-amber-950/20 p-6">
                <h3 className="text-lg font-semibold">Initial AI assessment: passed</h3>
                <p className="mt-2 text-sm text-slate-300">{(JSON.parse(paymentRequest.initialAssessmentJson) as Assessment).explanation}</p>
                <h3 className="mt-5 text-lg font-semibold">Review payment request</h3>
                <p className="mt-3 text-sm text-slate-400">Provider&apos;s completion statement</p>
                <p className="mt-1 whitespace-pre-wrap">{paymentRequest.completionStatement}</p>
                <p className="mt-4 text-sm text-slate-400">Requested amount</p>
                <p className="text-xl font-semibold">£{paymentRequest.requestedAmount.toFixed(2)}</p>
                <form onSubmit={respondToPaymentRequest} className="mt-5 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm text-slate-300">Your PayPal Sandbox email address</label>
                    <input type="email" value={paypalEmail} onChange={e => setPaypalEmail(e.target.value)} required className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                    <p className="mt-1 text-xs text-slate-500">Use the email address belonging to your PayPal Sandbox personal buyer account. The invoice will be sent to this address only if the assessment returns PROCEED.</p>
                  </div>
                  <div><label className="mb-2 block text-sm text-slate-300">Your objection (leave blank if you have none)</label><textarea value={customerObjection} onChange={e => setCustomerObjection(e.target.value)} rows={3} maxLength={5000} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" /></div>
                  <button disabled={assessmentLoading} className="w-full rounded-lg bg-blue-600 px-5 py-3 font-semibold disabled:opacity-50">{assessmentLoading ? "Assessing..." : "Submit response and assess"}</button>
                </form>
              </section>
            )}

            {paymentRequest?.status === "completed" && paymentRequest.assessmentJson && (
              <AssessmentDisplay assessment={JSON.parse(paymentRequest.assessmentJson) as Assessment} paymentRequest={paymentRequest} />
            )}
            {paymentRequest?.status === "failed" && <p className="mt-6 rounded-lg border border-red-800 p-4 text-sm text-red-300">The assessment could not be completed. Human review is required.</p>}
          </>
        )}

        {notice && <p className="mt-6 rounded-lg border border-green-900 bg-green-950/30 p-4 text-sm text-green-300">{notice}</p>}
        {error && <p className="mt-6 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">{error}</p>}
      </div>
    </main>
  );
}

function AssessmentDisplay({ assessment, paymentRequest }: { assessment: Assessment; paymentRequest: PaymentRequest }) {
  return <section className="mt-6 rounded-xl border border-slate-700 bg-slate-900 p-6">
    <h3 className="text-xl font-semibold">Assessment result</h3>
    <p className="mt-3 font-semibold">{assessment.outcome === "PROCEED" ? "PROCEED" : assessment.outcome === "DISCREPANCY_IDENTIFIED" ? "DISCREPANCY IDENTIFIED" : "HUMAN REVIEW REQUIRED"}</p>
    <p className="mt-3 text-sm leading-6 text-slate-300">{assessment.explanation}</p>
    {assessment.requirementsConsidered.length > 0 && <div className="mt-5"><h4 className="font-semibold">Requirements considered</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">{assessment.requirementsConsidered.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    {assessment.discrepancies.length > 0 && <div className="mt-5"><h4 className="font-semibold">Discrepancies</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">{assessment.discrepancies.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    {assessment.escalationReason && <p className="mt-5 text-sm text-amber-300">Human review reason: {assessment.escalationReason}</p>}
    <p className="mt-5 text-xs text-slate-500">Assessed: {new Date(assessment.assessedAt).toLocaleString()}</p>
    <p className="mt-2 text-xs text-slate-500">The assessment does not itself authorise or process payment.</p>
    {assessment.outcome === "PROCEED" && (
      <div className="mt-6 rounded-lg border border-slate-700 bg-slate-950 p-4">
        <h4 className="font-semibold">PayPal invoice</h4>
        {paymentRequest.paypalInvoiceStatus === "PAID" ? (
          <>
            <p className="mt-2 text-sm font-semibold text-green-300">Payment confirmed by PayPal.</p>
            <p className="mt-1 text-xs text-slate-400">Invoice reference: {paymentRequest.paypalInvoiceId}</p>
          </>
        ) : paymentRequest.paypalInvoiceStatus === "SENT" || paymentRequest.paypalInvoiceStatus === "UNPAID" ? (
          <>
            <p className="mt-2 text-sm text-green-300">Invoice created and sent to {paymentRequest.paypalRecipientEmail}. Payment is awaiting confirmation.</p>
            <p className="mt-1 text-xs text-slate-400">PayPal invoice reference: {paymentRequest.paypalInvoiceId}</p>
            {paymentRequest.paypalInvoiceUrl && <a href={paymentRequest.paypalInvoiceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-blue-400 underline">Open PayPal payment page</a>}
            {!paymentRequest.paypalInvoiceUrl && <p className="mt-2 text-sm text-slate-400">The invoice has been sent by PayPal. Check the buyer&apos;s Sandbox email for the payment link.</p>}
          </>
        ) : paymentRequest.paypalInvoiceStatus === "FAILED" ? (
          <p className="mt-2 text-sm text-amber-300">The assessment succeeded, but PayPal could not create or send the invoice. {paymentRequest.paypalError}</p>
        ) : (
          <p className="mt-2 text-sm text-slate-400">No PayPal invoice was created for this assessment.</p>
        )}
      </div>
    )}
  </section>;
}
