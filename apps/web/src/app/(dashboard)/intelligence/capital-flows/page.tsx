/**
 * Capital Flows — V3 intelligence hub.
 *
 * Founder directive ([[market_intel_v3_spec]]) Phase 1: 4 deep-dive
 * pages (Smart Money / Whale Flows / Stablecoin Liquidity / Exchange
 * Flows) consolidate under this hub. The overview surface uses the
 * shared HubOverview component so all 4 V3 hubs feel institutional and
 * consistent.
 */
import { Waves } from 'lucide-react'
import { loadIntelContext } from '../_components/guard'
import { composeIntelligenceGrid } from '@/lib/intelligence/grid'
import HubOverview, { type HubSpec } from '@/components/intelligence-hub/HubOverview'

export const metadata = { title: 'Capital Flows' }
export const dynamic  = 'force-dynamic'

const SPEC: HubSpec = {
  title: 'Capital Flows',
  subtitle: 'Track where money is moving — institutional accumulation, whale movements, stablecoin dry powder, and exchange-side flow.',
  icon: Waves,
  moduleKeys: ['smartMoney', 'whaleFlow'],
  deepLinks: [
    { label: 'Smart Money',          href: '/intelligence/smart-money',          blurb: 'Institutional capital-flow intelligence — bias, conviction, rotation, sectors.' },
    { label: 'Whale Flows',          href: '/intelligence/whale-flows',          blurb: 'Capital movement, accumulation vs distribution, persistence, aggression.' },
    { label: 'Stablecoin Liquidity', href: '/intelligence/stablecoin-liquidity', blurb: 'Dry-powder gauge — USDT / USDC supply pulse and on-chain liquidity shifts.' },
    { label: 'Exchange Flows',       href: '/intelligence/exchange-flows',       blurb: 'Net inflow vs outflow per exchange — sell pressure vs accumulation.' },
  ],
}

export default async function CapitalFlowsHub() {
  await loadIntelContext()
  const payload = await composeIntelligenceGrid()
  return <HubOverview spec={SPEC} payload={payload} />
}
