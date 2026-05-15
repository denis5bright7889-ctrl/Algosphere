/**
 * AlgoSphere Quant — Payment Notes panel
 * Reusable on /upgrade and anywhere else we surface crypto payment info.
 */
export default function PaymentNotes() {
  const notes = [
    <>Send only <strong className="text-foreground">USDT on the TRC20 network</strong>. Funds sent on other networks will be lost.</>,
    <>Payments are verified manually within <strong className="text-foreground">24 hours</strong>.</>,
    <>Your subscription activates <strong className="text-foreground">immediately after admin approval</strong>.</>,
    <>Contact support with your <strong className="text-foreground">TXID</strong> if not activated within 24 hours.</>,
  ]

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-5">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-amber" aria-hidden />
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-amber-300" aria-hidden>
            <path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold tracking-wide text-amber-300 uppercase">Payment notes</h3>
          <ul className="mt-3 space-y-2">
            {notes.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
