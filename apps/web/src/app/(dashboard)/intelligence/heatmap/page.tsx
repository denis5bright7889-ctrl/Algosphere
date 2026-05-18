import { loadIntelContext } from '../_components/guard'
import HeatmapClient from './HeatmapClient'

export const metadata = { title: 'On-Chain Heatmap' }
export const dynamic = 'force-dynamic'

export default async function HeatmapPage() {
  const { ent } = await loadIntelContext()
  return <HeatmapClient ent={ent} />
}
