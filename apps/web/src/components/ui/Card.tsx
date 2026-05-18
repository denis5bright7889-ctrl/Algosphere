import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * The single reusable card primitive for AlgoSphere Quant.
 *
 * Consolidates the previously scattered `.glass` / `.card-premium` /
 * `.card-brand` patterns into one typed surface with a fixed padding
 * scale and a consistent radius/border. Use this instead of hand-
 * rolling `rounded-xl border ... p-6` so spacing and elevation stay
 * uniform across every dashboard.
 *
 *   variant  glass  → frosted panel (default, on dark)
 *            solid  → opaque card surface
 *            brand  → solid + gold hairline on hover (feature cards)
 *   pad      none | sm | md | lg   — the only sanctioned step scale
 *   interactive  adds the premium hover-lift affordance
 */
type Variant = 'glass' | 'solid' | 'brand'
type Pad = 'none' | 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  glass: 'glass',
  solid: 'bg-card border border-border/70',
  brand: 'bg-card border border-border/70',
}

const PAD: Record<Pad, string> = {
  none: '',
  sm: 'p-3 sm:p-4',
  md: 'p-4 sm:p-5',
  lg: 'p-5 sm:p-6',
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  pad?: Pad
  interactive?: boolean
}

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'glass', pad = 'md', interactive = false, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl',
        VARIANT[variant],
        PAD[pad],
        interactive &&
          'transition-all duration-300 hover:-translate-y-0.5 ' +
            (variant === 'brand'
              ? 'hover:border-amber-500/40 hover:shadow-glow'
              : 'hover:border-primary/40 hover:shadow-card-lift'),
        className,
      )}
      {...props}
    />
  )
})

export default Card
