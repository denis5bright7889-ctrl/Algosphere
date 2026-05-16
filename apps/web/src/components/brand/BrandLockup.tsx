import Logo from './Logo'
import { cn } from '@/lib/utils'

/**
 * Responsive brand lockup.
 *  - Mobile: logo icon on top, "AlgoSphere Quant" centered below it.
 *  - ≥ sm: logo + wordmark inline (classic horizontal lockup).
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
      className={cn(
        'group flex items-center gap-2',
        'flex-col text-center sm:flex-row sm:text-left',
        className,
      )}
      aria-label="AlgoSphere Quant — home"
    >
      <Logo size="sm" alt="" priority={priority} />
      <span className="text-base font-bold leading-tight tracking-tight">
        <span className="text-gradient">AlgoSphere</span>{' '}
        <span className="text-foreground/90">Quant</span>
      </span>
    </a>
  )
}
