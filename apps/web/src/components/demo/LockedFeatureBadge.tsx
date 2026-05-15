import { cn } from '@/lib/utils'

interface Props {
  label?: string
  className?: string
}

/**
 * Inline badge for features that are visible in demo mode but cannot
 * be used (broker connection, withdrawals, live execution, etc.).
 */
export default function LockedFeatureBadge({ label = 'LIVE ONLY', className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400',
        className,
      )}
      title="Disabled in demo mode — upgrade to a live account to enable"
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
        <path d="M5 6V4a3 3 0 1 1 6 0v2h1.25c.69 0 1.25.56 1.25 1.25v5.5c0 .69-.56 1.25-1.25 1.25h-8.5C2.06 14 1.5 13.44 1.5 12.75v-5.5C1.5 6.56 2.06 6 2.75 6H5zm1 0h4V4a2 2 0 1 0-4 0v2z" />
      </svg>
      {label}
    </span>
  )
}
