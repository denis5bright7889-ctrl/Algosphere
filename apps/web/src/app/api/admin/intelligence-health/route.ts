/**
 * GET /api/admin/intelligence-health
 *
 * Admin-only. Returns the engine telemetry snapshot for the
 * /admin/intelligence-health page: per-engine health rows + the most
 * recent events for the failure log. Forbidden to all non-admins.
 *
 * Captures the data the founder spec required users NEVER see —
 * provider health, fallback activation, error classes (sanitized so
 * the page itself stays shareable). Per the admin-vs-user rule
 * ([[feedback_admin_vs_user_surfaces]]) this surface is the ONLY way
 * operators get this view.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import {
  aggregateHealth, snapshotEvents,
  type EngineHealthRow, type EngineEvent,
} from '@/lib/intelligence/engine-telemetry'

export const dynamic = 'force-dynamic'

export interface IntelligenceHealthPayload {
  rows:           EngineHealthRow[]
  recent_events:  EngineEvent[]
  total_captured: number
  generated_at:   string
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const all = snapshotEvents()
  const rows = aggregateHealth({ perEngineLimit: 100 })
  const payload: IntelligenceHealthPayload = {
    rows,
    // Newest-first 30 most recent events for the failure log section.
    recent_events:  all.slice(-30).reverse(),
    total_captured: all.length,
    generated_at:   new Date().toISOString(),
  }
  return NextResponse.json(payload)
}
