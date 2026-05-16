import Logo from './Logo'
import { cn } from '@/lib/utils'

/**
 * Responsive brand lockup for the marketing header (top-left).
 *
 *  - Mobile (< sm): NO logo image. Wordmark only, stacked left-aligned —
 *    "AlgoSphere" on top, "Quant" beneath it.
 *  - ≥ sm: classic horizontal lockup — logo mark + "AlgoSphere Quant"
 *    inline.
 */
export default function BrandLockup({
  href = '/',
  className,
  priority,
}: {
  href?: string
  className?: string
  priority?: boolean
}) {
  return (
    <a
      href={href}
      className={cn('group flex items-center gap-2', className)}
      aria-label="AlgoSphere Quant — home"
    >
      {/* Logo: hidden on mobile per design; shown ≥ sm */}
      <Logo size="sm" alt="" priority={priority} className="hidden sm:block" />

      {/* Mobile: stacked wordmark, left-aligned */}
      <span className="flex flex-col leading-tight sm:hidden">
        <span className="text-base font-extrabold tracking-tight text-gradient">AlgoSphere</span>
        <span className="-mt-0.5 text-sm font-bold tracking-tight text-foreground/90">Quant</span>
      </span>

      {/* Desktop: inline wordmark */}
      <span className="hidden text-base font-bold leading-tight tracking-tight sm:inline">
        <span className="text-gradient">AlgoSphere</span>{' '}
        <span className="text-foreground/90">Quant</span>
      </span>
    </a>
  )
}
