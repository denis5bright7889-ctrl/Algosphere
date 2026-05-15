import { cn } from '@/lib/utils'
import type { SubscriptionTier } from '@/lib/types'

interface Props {
  requiredTier: SubscriptionTier
  userTier: SubscriptionTier
  children: React.ReactNode
  upgradeHref?: string
  blurContent?: boolean
}

const TIER_LABEL: Record<SubscriptionTier, string> = {
  free:    'Free',
  starter: 'Starter',
  premium: 'Pro',
  vip:     'VIP',
}

const TIER_ORDER: Record<SubscriptionTier, number> = { free: 0, starter: 1, premium: 2, vip: 3 }

export default function TierGate({
  requiredTier,
  userTier,
  children,
  upgradeHref = '/upgrade',
  blurContent = true,
}: Props) {
  const hasAccess = TIER_ORDER[userTier] >= TIER_ORDER[requiredTier]

  if (hasAccess) return <>{children}</>

  return (
    <div className="relative rounded-lg overflow-hidden">
      {blurContent && (
        <div aria-hidden className="pointer-events-none select-none blur-sm opacity-40">
          {children}
        </div>
      )}
      <div className={cn(
        'flex flex-col items-center justify-center gap-3 p-6 text-center',
        blurContent && 'absolute inset-0',
        !blurContent && 'bg-muted/30 border border-border rounded-lg',
      )}>
        <div className="rounded-full bg-primary/10 p-3">
          <span className="text-2xl">🔒</span>
        </div>
        <div>
          <p className="font-semibold text-foreground">
            {TIER_LABEL[requiredTier]} plan required
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Upgrade to unlock this feature
          </p>
        </div>
        <a
          href={upgradeHref}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Upgrade to {TIER_LABEL[requiredTier]}
        </a>
      </div>
    </div>
  )
}
