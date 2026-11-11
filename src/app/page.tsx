import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold tracking-tight">SignPay</Link>
          <Link
            href="/agreement"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-900"
          >
            Sign in
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-12 py-16 md:grid-cols-[1.15fr_0.85fr] md:py-24">
          <div>
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-blue-400">
              Agreements before payments
            </p>
            <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Agree the work. Record the terms. Assess the payment.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              SignPay helps service providers and customers record what was agreed before work begins, then assess payment requests against those terms.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/agreement"
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500"
              >
                Get started
              </Link>
              <Link
                href="/agreement"
                className="inline-flex items-center justify-center rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 transition hover:bg-slate-900"
              >
                Open an agreement
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">
              You will be able to register or sign in before creating or accessing agreements.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl shadow-black/20">
            <h2 className="text-lg font-semibold">How SignPay works</h2>
            <ol className="mt-6 space-y-6">
              <li className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-sm font-bold text-blue-300">1</span>
                <div>
                  <h3 className="font-semibold">Record the agreement</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">Set out the work, specific requirements and agreed payment amount.</p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-sm font-bold text-blue-300">2</span>
                <div>
                  <h3 className="font-semibold">Both parties sign</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">Each participant reviews and signs the same recorded terms.</p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-sm font-bold text-blue-300">3</span>
                <div>
                  <h3 className="font-semibold">Assess the payment request</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">SignPay checks the submitted completion details against the agreement and flags discrepancies for review.</p>
                </div>
              </li>
            </ol>
            <p className="mt-7 border-t border-slate-800 pt-5 text-xs leading-5 text-slate-500">
              SignPay assesses submitted information. It does not independently verify that work has physically been completed.
            </p>
          </div>
        </section>

        <footer className="border-t border-slate-800 py-5 text-sm text-slate-500">
          SignPay · Agreement-led payment assessment
        </footer>
      </div>
    </main>
  );
}
