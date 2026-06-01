/**
 * Market Structure — V3 intelligence hub.
 *
 * Founder directive ([[market_intel_v3_spec]]) Phase 1: Dominance &
 * Rotation + Sector Intelligence + Market Breadth + Market Rotation
 * consolidate under this hub. Structural read: where capital is
 * rotating and how broad participation is.
 */
import { Repeat } from 'lucide-react'
import { loadIntelContext } from '../_components/guard'
import { composeIntelligenceGrid } from '@/lib/intelligence/grid'
import HubOverview, { type HubSpec } from '@/components/intelligence-hub/HubOverview'

export const metadata = { title: 'Market Structure' }
export const dynamic  = 'force-dynamic'

const SPEC: HubSpec = {
  title: 'Market Structure',
  subtitle: 'Track structure and rotation — dominance shifts, sector leadership, breadth, and capital rotation.',
  icon: Repeat,
  moduleKeys: ['dominance', 'breadth'],
  deepLinks: [
    { label: 'Dominance & Rotation', href: '/intelligence/dominance',        blurb: 'BTC dominance, market-cap sentiment, risk-on / risk-off rotation between major buckets.' },
    { label: 'Sector Intelligence',  href: '/intelligence/sectors',          blurb: 'Sector performance, leadership across DeFi / L1s / Memes / AI / RWA / Infra.' },
    { label: 'Market Breadth',       href: '/intelligence/breadth',          blurb: 'Advancers vs decliners, breadth posture, broad / narrow / declining participation.' },
    { label: 'Market Rotation',      href: '/intelligence/market-rotation',  blurb: 'Capital rotation between sectors — what is gaining, what is fading.' },
  ],
}

export default async function StructureHub() {
  await loadIntelContext()
  const payload = await composeIntelligenceGrid()
  return <HubOverview spec={SPEC} payload={payload} />
}
