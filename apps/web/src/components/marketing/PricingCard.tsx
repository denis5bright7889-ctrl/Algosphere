import type { Plan } from '@/lib/types'
import { cn } from '@/lib/utils'

interface Props {
  plan: Plan
}

const CTA_LABEL: Record<string, string> = {
  starter: 'Get Starter',
  premium: 'Get Pro',
  vip:     'Get VIP',
}

const SHORT_DESC: Record<string, string> = {
  starter: 'For active retail traders getting started with daily signals.',
  premium: 'Institutional-grade analytics + multi-channel alerts.',
  vip:     'Copy-trading, private group, and dedicated risk advisor.',
}

export default function PricingCard({ plan }: Props) {
  const isFree    = plan.id === 'free'
  const isPremium = plan.id === 'premium'   // marked "Most popular"
  const isVip     = plan.id === 'vip'

  // VIP gets a richer treatment (gradient border) but Pro keeps the
  // "Most popular" badge.
  return (
    <div
      className={cn(
        'relative rounded-2xl border p-6 flex flex-col transition-all duration-300',
        isPremium && 'border-amber-500/40 bg-card shadow-glow-gold lg:scale-[1.02]',
        isVip     && 'border-amber-500/30 bg-gradient-to-b from-amber-500/[0.06] to-card hover:border-amber-500/50 hover:shadow-glow',
        !isPremium && !isVip && 'border-border bg-card hover:border-amber-500/30 hover:shadow-card-lift',
      )}
    >
      {isPremium && (
        <>
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-gold rounded-t-2xl" aria-hidden />
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-gold px-3 py-1 text-[10px] font-bold tracking-widest text-black uppercase shadow-glow-gold">
            Most popular
          </span>
        </>
      )}

      {isVip && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-amber-500/40 bg-background px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase">
          Institutional
        </span>
      )}

      <div className="mb-4">
        <h3 className={cn(
          'text-lg font-bold tracking-tight',
          (isPremium || isVip) && 'text-gradient',
        )}>
          {plan.name}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
          {SHORT_DESC[plan.id] ?? ''}
        </p>
        <div className="mt-3 flex items-end gap-1">
          <span className={cn(
            'text-4xl font-extrabold tabular-nums',
            (isPremium || isVip) && 'text-gradient',
          )}>
            {plan.price === 0 ? 'Free' : `$${plan.price}`}
          </span>
          {plan.price > 0 && (
            <span className="mb-1 text-sm text-muted-foreground">/month</span>
          )}
        </div>
      </div>

      <ul className="mb-6 flex-1 space-y-2">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0 text-amber-400">✓</span>
            <span className="text-foreground/85">{f}</span>
          </li>
        ))}
      </ul>

      {isFree ? (
        <a href="/signup" className="btn-glass w-full justify-center">
          Start free
        </a>
      ) : (
        <div className="space-y-2">
          <a
            href={`/demo/${plan.id}`}
            className={cn(
              'block w-full text-center text-sm',
              (isPremium || isVip) ? 'btn-premium' : 'btn-glass justify-center',
            )}
          >
            {CTA_LABEL[plan.id] ?? 'Choose plan'}
          </a>
          <p className="text-center text-[11px] text-muted-foreground">
            Try the demo first — pay with USDT TRC20 when ready.
          </p>
        </div>
      )}
    </div>
  )
}
