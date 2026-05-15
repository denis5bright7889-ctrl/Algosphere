import { FEATURE_CATALOG, TIER_PROMISE } from '@/lib/entitlements'
import { cn } from '@/lib/utils'

const TIERS = [
  { id: 'starter', label: 'Starter', price: '$29' },
  { id: 'premium', label: 'Pro',     price: '$99'  },
  { id: 'vip',     label: 'VIP',     price: '$299' },
] as const

const RANK = { starter: 1, premium: 2, vip: 3 } as const

function Check({ on }: { on: boolean }) {
  return on ? (
    <span className="text-amber-400" aria-label="included">✓</span>
  ) : (
    <span className="text-muted-foreground/40" aria-label="not included">—</span>
  )
}

/**
 * Catalog-driven tier comparison. Renders FEATURE_CATALOG so the matrix can
 * never drift from the entitlement source of truth.
 */
export default function FeatureMatrix() {
  return (
    <div className="mt-12 rounded-2xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-4 text-left font-semibold text-muted-foreground">
                Everything you get
              </th>
              {TIERS.map(t => (
                <th key={t.id} className="px-4 py-4 text-center">
                  <div className="text-gradient font-bold">{t.label}</div>
                  <div className="text-xs text-muted-foreground">{t.price}/mo</div>
                  <div className="mt-1 text-[10px] text-amber-300/80 italic font-normal">
                    {TIER_PROMISE[t.id]}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURE_CATALOG.map(group => (
              <FeatureGroupRows key={group.group} group={group.group} features={group.features} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FeatureGroupRows({
  group, features,
}: {
  group: string
  features: { key: string; label: string; minTier: 'starter' | 'premium' | 'vip' }[]
}) {
  return (
    <>
      <tr className="bg-muted/30">
        <td colSpan={4} className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-amber-300/90">
          {group}
        </td>
      </tr>
      {features.map(ft => (
        <tr key={ft.key} className="border-b border-border/60 last:border-0">
          <td className="px-4 py-2.5 text-foreground/85">{ft.label}</td>
          {TIERS.map(t => (
            <td key={t.id} className={cn(
              'px-4 py-2.5 text-center',
              t.id === 'premium' && 'bg-amber-500/[0.03]',
            )}>
              <Check on={RANK[t.id] >= RANK[ft.minTier]} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
