import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Card that links to another settings surface (brokers, alerts, API keys…).
 * Used inside the /settings hub so users can pivot without losing context.
 */
export default function QuickLink({
  href, icon: Icon, title, description, badge, disabled, disabledReason,
}: {
  href:           string
  icon:           LucideIcon
  title:          string
  description:    string
  badge?:         string
  disabled?:      boolean
  disabledReason?: string
}) {
  const Wrapper = disabled ? 'div' : 'a'
  return (
    <Wrapper
      {...(disabled ? {} : { href })}
      className={cn(
        'group flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3 transition-colors',
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'hover:border-amber-500/30 hover:bg-card',
      )}
      title={disabled ? disabledReason : undefined}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/30 text-amber-300/80">
        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex-1 min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          {title}
          {badge && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
              {badge}
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">{description}</p>
      </div>
      {!disabled && (
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
      )}
    </Wrapper>
  )
}
