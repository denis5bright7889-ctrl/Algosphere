import { loadIntelContext } from '../_components/guard'
import WhaleFlowsClient from './WhaleFlowsClient'

export const metadata = { title: 'Whale Flows' }
export const dynamic = 'force-dynamic'

export default async function WhaleFlowsPage() {
  const { ent } = await loadIntelContext()
  return <WhaleFlowsClient ent={ent} />
}
