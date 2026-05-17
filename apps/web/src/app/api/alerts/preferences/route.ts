/**
 * GET   /api/alerts/preferences  — current user's notification prefs
 * PATCH /api/alerts/preferences  — update channel toggles or routing rules
 *
 * `routing_rules` is a JSONB map keyed by either:
 *   • notif_type   (fine-grained: "signal_from_leader": ["telegram"])
 *   • category key (coarse:       "signals": { enabled: true,
 *                                              channels: ["push","telegram"] })
 *
 * This endpoint accepts a partial patch — only sent keys are merged.
 */
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const patchSchema = z.object({
  email_enabled:    z.boolean().optional(),
  telegram_enabled: z.boolean().optional(),
  push_enabled:     z.boolean().optional(),
  whatsapp_enabled: z.boolean().optional(),
  sms_enabled:      z.boolean().optional(),
  // Partial routing rules — merged onto whatever's stored.
  routing_rules:    z.record(z.string(), z.unknown()).optional(),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({ preferences: data ?? null })
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }
  const { routing_rules, ...flags } = parsed.data

  // Merge routing_rules with whatever is currently stored (partial patch).
  let mergedRouting: Record<string, unknown> | undefined
  if (routing_rules) {
    const { data: existing } = await supabase
      .from('notification_preferences')
      .select('routing_rules')
      .eq('user_id', user.id)
      .maybeSingle()
    const prior = (existing?.routing_rules as Record<string, unknown> | null) ?? {}
    mergedRouting = { ...prior, ...routing_rules }
  }

  const upsertRow: Record<string, unknown> = {
    user_id:    user.id,
    updated_at: new Date().toISOString(),
    ...flags,
  }
  if (mergedRouting !== undefined) upsertRow.routing_rules = mergedRouting

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(upsertRow, { onConflict: 'user_id' })
    .select('*')
    .single()

  if (error) {
    console.error('preferences PATCH failed:', error)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
  return NextResponse.json({ preferences: data })
}
