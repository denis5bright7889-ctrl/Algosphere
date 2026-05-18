import { intelligenceRoute } from '@/services/onchain/handler'
export const dynamic = 'force-dynamic'
// Stablecoin liquidity page composes two provider feeds; this route
// serves the inflows. Liquidity shifts are fetched via ?part=shifts.
export const GET = intelligenceRoute((p, q) => p.getStablecoinInflows(q))
