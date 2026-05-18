import { loadIntelContext } from '../_components/guard'
import ExchangeFlowsClient from './ExchangeFlowsClient'

export const metadata = { title: 'Exchange Flows' }
export const dynamic = 'force-dynamic'

export default async function ExchangeFlowsPage() {
  const { ent } = await loadIntelContext()
  return <ExchangeFlowsClient ent={ent} />
}
