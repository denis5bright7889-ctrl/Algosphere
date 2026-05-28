import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  icon?:     LucideIcon
  title:     string
  description?: string
  /** Primary action (rendered as a gold button). */
  action?:   { label: string; href: string }
  /** Quiet secondary link. */
  secondary?: { label: string; href: string }
  className?: string
}

/**
 * Institutional empty state — calm, never a dead end. Always gives the
 * user the next step. Used for zero-data, not-connected and
 * not-yet-configured surfaces (honest states, never fabricated data).
 */
export default function EmptyState({
  icon: Icon, title, description, action, secondary, className,
}: Props) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70',
        'bg-card/30 px-6 py-14 text-center',
        className,
      )}
    >
      {Icon && (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted/30">
          <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        </span>
      )}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {(action || secondary) && (
        <div className="mt-5 flex items-center gap-3">
          {action && (
            <a href={action.href} className="btn-premium !px-5 !py-2 !text-xs">
              {action.label}
            </a>
          )}
          {secondary && (
            <a
              href={secondary.href}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {secondary.label}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
