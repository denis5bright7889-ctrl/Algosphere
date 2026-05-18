import type { LucideIcon } from 'lucide-react'
import { Clock, ShieldAlert } from 'lucide-react'

/**
 * Shared chrome for every Intelligence page: glass header (icon +
 * title + subtitle + band pill), an honest "delayed data" banner for
 * FREE/PRO bands, and a provider-transparency footer. Pages drop
 * their visualisation in as children.
 */
export default function IntelShell({
  icon: Icon, title, subtitle, band, delayed, delayMinutes,
  source, children,
}: {
  icon:         LucideIcon
  title:        string
  subtitle:     string
  band:         'FREE' | 'PRO' | 'ELITE' | 'INSTITUTIONAL'
  delayed:      boolean
  delayMinutes: number
  source:       string
  children:     React.ReactNode
}) {
  const bandCls =
    band === 'INSTITUTIONAL' ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
    : band === 'ELITE'       ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
    : band === 'PRO'         ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
    : 'border-border bg-muted/30 text-muted-foreground'

  return (
    <div className="mx-auto max-w-6xl space-y-5 animate-fade-in">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold tracking-tight">
            <Icon className="h-5 w-5 text-amber-300" strokeWidth={1.75} aria-hidden />
            {title}
          </h1>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${bandCls}`}>
            {band}
          </span>
        </div>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">{subtitle}</p>
      </header>

      {delayed && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span>
            Showing data delayed ~{delayMinutes} min on your plan.{' '}
            <a href="/upgrade" className="font-semibold underline hover:no-underline">
              Upgrade for live intelligence
            </a>.
          </span>
        </div>
      )}

      {children}

      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <ShieldAlert className="h-3 w-3" strokeWidth={1.75} aria-hidden />
        Provider: <span className="font-mono">{source}</span> · categorical signal, not financial
        advice. Data source abstracted — swappable without UI change.
      </p>
    </div>
  )
}
