import { demoLabel } from '@/lib/demo'

interface Props {
  accountType: string | null | undefined
}

export default function DemoBanner({ accountType }: Props) {
  if (accountType !== 'demo_starter' && accountType !== 'demo_premium') return null

  return (
    <div className="relative border-b border-amber-500/30 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-amber animate-shimmer" aria-hidden />
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2 md:px-6">
        <div className="flex items-center gap-3 text-sm">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
          </span>
          <span className="font-bold tracking-wider text-amber-300 uppercase text-xs">
            Demo Mode Active
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {demoLabel(accountType)} — Data is simulated. No real trading enabled.
          </span>
        </div>
        <a
          href="/upgrade"
          className="btn-premium !py-1.5 !text-xs"
        >
          Upgrade to Live Account
        </a>
      </div>
    </div>
  )
}
