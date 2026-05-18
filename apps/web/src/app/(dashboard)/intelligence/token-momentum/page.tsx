import { loadIntelContext } from '../_components/guard'
import TokenMomentumClient from './TokenMomentumClient'

export const metadata = { title: 'Token Momentum' }
export const dynamic = 'force-dynamic'

export default async function TokenMomentumPage() {
  const { ent } = await loadIntelContext()
  return <TokenMomentumClient ent={ent} />
}
