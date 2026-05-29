import { notFound } from 'next/navigation'

/**
 * Phase R1: public trader profile route retired alongside the
 * Leaderboard. Returns 404.
 */
export const metadata = { title: 'Not Found — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'
export default function Page() { notFound() }
