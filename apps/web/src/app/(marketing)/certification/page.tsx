/**
 * Public viewer for the AlgoSphere Company Certification SVG.
 *
 * The SVG is the actual artifact (vector image). This page renders it
 * full-bleed with download + print-to-PDF affordances so anyone can
 * grab a hi-res PNG (via "Save as image") or PDF (browser print).
 *
 * No auth required.
 */
import Link from 'next/link'

export const metadata = {
  title:       'AlgoSphere Company Certification',
  description: 'Certificate of Platform Operational Standing — AlgoSphere Quant.',
}

export default function CertificationPage() {
  return (
    <main className="min-h-screen bg-black px-4 py-8 print:p-0 print:bg-white">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href="/" className="text-sm font-semibold text-amber-300 hover:text-amber-200">
            ← AlgoSphere Quant
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <a
              href="/algosphere-company-certification.svg"
              download="AlgoSphere-Company-Certification.svg"
              className="rounded-md border border-amber-500/40 bg-amber-500/[0.08] px-3 py-1.5 font-bold uppercase tracking-wider text-amber-300 hover:bg-amber-500/15"
            >
              ↓ Download SVG
            </a>
            <a
              href="/algosphere-company-certification.svg"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border bg-card px-3 py-1.5 font-bold uppercase tracking-wider text-foreground hover:bg-muted/30"
            >
              Open Raw
            </a>
            <PrintButton />
          </div>
        </header>

        <div className="rounded-2xl border border-amber-500/30 bg-black p-2 shadow-2xl shadow-amber-500/10 print:rounded-none print:border-0 print:shadow-none print:p-0">
          {/* Object renders the SVG natively, preserving vector quality */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/algosphere-company-certification.svg"
            alt="AlgoSphere Quant — Certificate of Platform Operational Standing"
            className="w-full h-auto block"
          />
        </div>

        <p className="mx-auto mt-6 max-w-3xl text-center text-[11px] leading-relaxed text-muted-foreground print:hidden">
          This certificate documents internal platform-standard compliance with the
          AlgoSphere AI Strategy Validation Center spec. It is <strong className="text-foreground">not</strong> a
          regulatory or legal certification. Verifiable at{' '}
          <Link href="/api/admin/validation-center/verify" className="text-amber-300 underline">
            /api/admin/validation-center/verify
          </Link>.
        </p>
      </div>
    </main>
  )
}

function PrintButton() {
  return (
    <form action="javascript:window.print()">
      <button
        type="submit"
        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-muted/30"
      >
        Print / Save PDF
      </button>
    </form>
  )
}
