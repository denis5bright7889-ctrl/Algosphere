/**
 * Market Sentiment — V3 intelligence hub.
 *
 * Founder directive ([[market_intel_v3_spec]]) Phase 1: Narrative +
 * Attention + Participation consolidate under this hub. Crowd behavior:
 * what is being talked about, where attention is concentrating, who is
 * participating.
 */
import { MessagesSquare } from 'lucide-react'
import { loadIntelContext } from '../_components/guard'
import { composeIntelligenceGrid } from '@/lib/intelligence/grid'
import HubOverview, { type HubSpec } from '@/components/intelligence-hub/HubOverview'

export const metadata = { title: 'Market Sentiment' }
export const dynamic  = 'force-dynamic'

const SPEC: HubSpec = {
  title: 'Market Sentiment',
  subtitle: 'Track crowd behavior — narrative landscape, social attention, and who is actually participating.',
  icon: MessagesSquare,
  // The decision-brain doesn't yet emit explicit sentiment modules; the
  // hub overview tiles still surface Coverage / Reliability tied to the
  // engines this hub depends on. Deep-link rail carries the user into
  // the specialist surfaces immediately.
  moduleKeys: [],
  deepLinks: [
    { label: 'Narrative',     href: '/intelligence/narrative',     blurb: 'Theme tracker — strength, acceleration, fatigue, crowding, institutional participation.' },
    { label: 'Attention',     href: '/intelligence/attention',     blurb: 'Social attention — mention velocity, surging vs cooling narratives.' },
    { label: 'Participation', href: '/intelligence/participation', blurb: 'Who is driving price — smart money / whales / aggression per asset.' },
  ],
}

export default async function SentimentHub() {
  await loadIntelContext()
  const payload = await composeIntelligenceGrid()
  return <HubOverview spec={SPEC} payload={payload} />
}
