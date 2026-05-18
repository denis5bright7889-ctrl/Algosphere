import { loadIntelContext } from '../_components/guard'
import SmartMoneyClient from './SmartMoneyClient'

export const metadata = { title: 'Smart Money' }
export const dynamic = 'force-dynamic'

export default async function SmartMoneyPage() {
  const { ent } = await loadIntelContext()
  return <SmartMoneyClient ent={ent} />
}
