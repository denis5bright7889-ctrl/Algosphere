import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  icon?:      LucideIcon
  title:      string
  /** Short context line under the title. */
  subtitle?:  string
  /** Right-aligned controls (filters, actions, status). */
  actions?:   React.ReactNode
  /** Honest data-state chip, e.g. "Live", "Delayed", "Simulation". */
  badge?:     { label: string; tone?: 'live' | 'muted' | 'warn' }
  className?: string
}

const BADGE: Record<string, string> = {
  live:  'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warn:  'border-amber-500/30 bg-amber-500/10 text-amber-300',
  muted: 'border-border bg-muted/30 text-muted-foreground',
}

/**
 * Consistent section header — the spacing/typography anchor for every
 * panel. Standardising this is what makes the platform read as one
 * coherent system instead of many ad-hoc screens.
 */
export default function SectionHeader({
  icon: Icon, title, subtitle, actions, badge, className,
}: Props) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/30">
            <Icon className="h-4 w-4 text-amber-300/90" strokeWidth={1.75} aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-bold tracking-tight">{title}</h2>
            {badge && (
              <span
                className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                  BADGE[badge.tone ?? 'muted'],
                )}
              >
                {badge.label}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
