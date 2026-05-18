import ProbeForm from './ProbeForm'

export const metadata = { title: 'Dune Probe — Admin · AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

/**
 * Admin-gated UI in front of `/api/admin/dune-probe`. The layout's
 * `isAdmin()` check already guards this route — no extra gate needed
 * here. The page is a thin shell; the form does the work.
 */
export default function DuneProbePage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-gradient">Dune</span> Probe
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Exercise a Dune query end-to-end before relying on it in an Intelligence
          dashboard. <span className="font-mono">latest</span> mode reads cached
          results (no Dune credit); <span className="font-mono">execute</span> runs
          a fresh execution (spends one credit per call).
        </p>
      </header>
      <ProbeForm />
    </div>
  )
}
