import { notFound } from 'next/navigation'

/**
 * Phase R1: public Trader Leaderboard removed during platform refocus
 * to trader intelligence. The full file (with leaderboard helpers,
 * verification badges, etc.) is preserved in git history and may be
 * reused inside the AI Coach module if individual self-tracking
 * metrics need a public surface. Returns 404 for now.
 */
export const metadata = { title: 'Not Found — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'
export default function Page() { notFound() }
