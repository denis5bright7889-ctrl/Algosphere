import { intelligenceRoute } from '@/services/onchain/handler'
export const dynamic = 'force-dynamic'
export const GET = intelligenceRoute((p, q) => p.getWhaleFlows(q))
