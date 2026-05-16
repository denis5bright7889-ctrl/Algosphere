import type { LucideIcon } from 'lucide-react'

/**
 * Institutional glass panel. Consistent header (thin-line icon + title),
 * optional right-aligned action link, neon top hairline.
 */
export default function Panel({
  title, icon: Icon, href, hrefLabel = 'View all', children, className = '',
}: {
  title:      string
  icon:       LucideIcon
  href?:      string
  hrefLabel?: string
  children:   React.ReactNode
  className?: string
}) {
  return (
    <section
      className={
        'relative overflow-hidden rounded-2xl border border-border/70 glass ' +
        'p-4 sm:p-5 ' + className
      }
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary opacity-50" aria-hidden />
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Icon className="h-4 w-4 text-amber-300/80" strokeWidth={1.75} aria-hidden />
          {title}
        </h2>
        {href && (
          <a href={href} className="text-xs text-muted-foreground transition-colors hover:text-amber-300">
            {hrefLabel} →
          </a>
        )}
      </div>
      {children}
    </section>
  )
}
