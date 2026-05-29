import { notFound } from 'next/navigation'

/**
 * Refocus R7: route retired during the schema cleanup. Its data
 * sources (trader_scores / trader_verifications / published_strategies)
 * are dropped in migration 052/053 — the page itself loses meaning
 * under the AI-trader-intelligence refocus. The kept companion is
 * /intelligence/me which surfaces individual self-tracking instead.
 */
export const dynamic = 'force-dynamic'
export default function Page() { notFound() }
