/**
 * <TierLock> — visible upgrade-pressure gate.
 *
 * Pure presentation. Wraps content that requires a minimum tier. If the
 * viewer's effective tier meets `minTier` → renders the children plainly.
 * Otherwise renders the brief's "blur + lock + upgrade CTA" pattern that
 * makes the feature visible-but-locked (better than hiding, because it
 * drives upgrades).
 *
 * Variants:
 *   card   — full content blurred underneath, centered lock card on top
 *            (use to wrap page-level content)
 *   nav    — wraps a nav link, dims it + adds a tier badge
 *   inline — small inline "Members only" pill for fields (e.g. signal levels)
 *
 * SAFETY: `<TierLock variant="card">` blurs visually only — the wrapped
 * children are still rendered. Use it for UI tools / dashboards. For
 * sensitive paid DATA (entry/SL/TP signal levels), the data must NOT
 * reach the client — that gating stays server-side in `canAccess()` +
 * `redactLockedSignal()` (see `lib/signal-abstraction`).
 */
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SubscriptionTier } from '@/lib/types'

const RANK: Record<SubscriptionTier, number> = { free: 0, starter: 1, premium: 2, vip: 3 }
const LABEL: Record<SubscriptionTier, string> = {
  free: 'Free', starter: 'Starter', premium: 'Premium', vip: 'VIP',
}

export type TierLockVariant = 'card' | 'nav' | 'inline'

export interface TierLockProps {
  /** The minimum tier required to see the children unlocked. */
  minTier:  SubscriptionTier
  /** The viewer's effective tier (use `getEffectiveTier()` to resolve). */
  tier:     SubscriptionTier
  variant?: TierLockVariant
  /** Optional source route — appended to the upgrade URL for analytics. */
  from?:    string
  children: React.ReactNode
}

function upgradeHref(minTier: SubscriptionTier, from?: string): string {
  const params = new URLSearchParams({ need: minTier })
  if (from) params.set('from', from)
  return `/upgrade?${params.toString()}`
}

export default function TierLock({
  minTier, tier, variant = 'card', from, children,
}: TierLockProps) {
  const allowed = (RANK[tier] ?? 0) >= (RANK[minTier] ?? 0)
  if (allowed) return <>{children}</>

  const href = upgradeHref(minTier, from)

  if (variant === 'inline') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
        <Lock className="h-3 w-3" strokeWidth={2} aria-hidden />
        {LABEL[minTier]}
        <Link href={href} className="ml-1 underline decoration-amber-400/60 hover:decoration-amber-300">Upgrade</Link>
      </span>
    )
  }

  if (variant === 'nav') {
    return (
      <Link
        href={href}
        title={`${LABEL[minTier]} tier required`}
        className="group relative block opacity-70 hover:opacity-100 transition-opacity"
      >
        {children}
        <span className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[9px] font-bold uppercase tracking-wider text-amber-300">
          <Lock className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
          {LABEL[minTier]}
        </span>
      </Link>
    )
  }

  // 'card' — the brief's blur + centered-lock pattern
  return (
    <div className="relative">
      <div
        aria-hidden
        className={cn(
          'pointer-events-none select-none',
          'blur-sm grayscale opacity-40',
          // Keep the layout intact so the locked card slots into the page,
          // but absorb scroll on the underlying content.
          'overflow-hidden',
        )}
      >
        {children}
      </div>
      <div className="absolute inset-0 flex items-start justify-center p-6 sm:p-10 md:items-center">
        <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-card/95 p-6 text-center shadow-2xl backdrop-blur md:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10">
            <Lock className="h-5 w-5 text-amber-300" strokeWidth={2} aria-hidden />
          </div>
          <h3 className="mt-3 text-lg font-bold tracking-tight md:text-xl">
            {LABEL[minTier]} feature
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            This area is part of the <span className="font-semibold text-foreground/90">{LABEL[minTier]}</span> tier.
            Upgrade to unlock the full surface.
          </p>
          <Link
            href={href}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gradient-primary px-5 py-2.5 text-sm font-bold text-black shadow-glow-gold"
          >
            Upgrade to {LABEL[minTier]} →
          </Link>
          <p className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            Your tier: <span className="font-semibold text-foreground/80">{LABEL[tier]}</span>
          </p>
        </div>
      </div>
    </div>
  )
}
