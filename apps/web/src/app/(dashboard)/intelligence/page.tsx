/**
 * /intelligence — Analyze Mode workspace (Bloomberg-style grid).
 *
 * Was a link-list index of every intelligence sub-page. Now it's the
 * unified intelligence grid: one card per Decision-Brain engine, each a
 * live intelligence unit that expands into a right-side drawer (no page
 * navigation inside Analyze Mode). The standalone deep-dive pages still
 * exist and are one ⌘K away; this is the scannable decision surface.
 *
 * Server shell = auth gate only; the grid client fetches
 * /api/intelligence/grid and self-refreshes.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import IntelligenceGrid from '@/components/analyze/IntelligenceGrid'

export const metadata = { title: 'Market Intelligence — AlgoSphere Quant' }
export const dynamic   = 'force-dynamic'

export default async function IntelligencePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <IntelligenceGrid />
}
