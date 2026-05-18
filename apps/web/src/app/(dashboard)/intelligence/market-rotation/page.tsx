import { loadIntelContext } from '../_components/guard'
import MarketRotationClient from './MarketRotationClient'

export const metadata = { title: 'Market Rotation' }
export const dynamic = 'force-dynamic'

export default async function MarketRotationPage() {
  const { ent } = await loadIntelContext()
  return <MarketRotationClient ent={ent} />
}
