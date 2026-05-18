import { loadIntelContext } from '../_components/guard'
import StablecoinLiquidityClient from './StablecoinLiquidityClient'

export const metadata = { title: 'Stablecoin Liquidity' }
export const dynamic = 'force-dynamic'

export default async function StablecoinLiquidityPage() {
  const { ent } = await loadIntelContext()
  return <StablecoinLiquidityClient ent={ent} />
}
