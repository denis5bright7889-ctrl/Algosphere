/**
 * Momentum — V3 intelligence hub.
 *
 * Founder directive ([[market_intel_v3_spec]]) Phase 1: Conviction +
 * Momentum Phase + Positioning consolidate under this hub. Per-symbol
 * momentum + multi-layer agreement + crowding.
 *
 * Lives at /intelligence/momentum-hub because /intelligence/momentum is
 * occupied by the deep "Momentum Phase" view — preserving existing
 * routes was the founder constraint.
 */
import { Rocket } from 'lucide-react'
import { loadIntelContext } from '../_components/guard'
import { composeIntelligenceGrid } from '@/lib/intelligence/grid'
import HubOverview, { type HubSpec } from '@/components/intelligence-hub/HubOverview'

export const metadata = { title: 'Momentum' }
export const dynamic  = 'force-dynamic'

const SPEC: HubSpec = {
  title: 'Momentum',
  subtitle: 'Per-symbol momentum intelligence — multi-layer conviction, phase classification, positioning and crowding.',
  icon: Rocket,
  moduleKeys: ['momentum'],
  deepLinks: [
    { label: 'Conviction',     href: '/intelligence/conviction',  blurb: 'Multi-layer agreement: Momentum / Regime / Volatility / Smart Money / Participation / Macro per asset.' },
    { label: 'Momentum Phase', href: '/intelligence/momentum',    blurb: 'Phase + direction + quality + sustainability across the basket.' },
    { label: 'Positioning',    href: '/intelligence/positioning', blurb: 'Leverage / crowding / liquidation risk across major pairs.' },
  ],
}

export default async function MomentumHub() {
  await loadIntelContext()
  const payload = await composeIntelligenceGrid()
  return <HubOverview spec={SPEC} payload={payload} />
}
