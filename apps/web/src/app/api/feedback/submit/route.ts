/**
 * POST /api/feedback/submit — create a new feedback submission.
 *
 * Auth: any logged-in user. Rate-limited to 5 submissions/user/hour
 * (counted server-side from the feedback_submissions table itself; no
 * external store needed at this volume).
 *
 * Side effects:
 *   - Inserts one row into feedback_submissions
 *   - Notifies Discord — bugs go to #bug_reports, everything else to
 *     #support. Notification failures don't fail the request.
 *
 * Returns the inserted row so the UI can show "submitted" with the id.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notify, EMBED_COLOR } from '@/lib/notifications/discord'
import {
  SubmissionInputSchema, SUBMIT_RATE_LIMIT_PER_HOUR,
  TYPE_LABEL,
} from '@/lib/feedback'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = SubmissionInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.format() },
      { status: 422 },
    )
  }
  const input = parsed.data

  // Rate limit. Count of THIS user's submissions in the last hour.
  // The (user_id, created_at DESC) WHERE deleted_at IS NULL index makes
  // this a cheap range scan — no slow query even at thousands of rows.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countErr } = await supabase
    .from('feedback_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', oneHourAgo)
    .is('deleted_at', null)

  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 })
  }
  if ((count ?? 0) >= SUBMIT_RATE_LIMIT_PER_HOUR) {
    return NextResponse.json(
      {
        error: `Rate limit: ${SUBMIT_RATE_LIMIT_PER_HOUR} submissions per hour. Try again later.`,
      },
      { status: 429 },
    )
  }

  const { data: row, error: insertErr } = await supabase
    .from('feedback_submissions')
    .insert({
      user_id:     user.id,
      type:        input.type,
      rating:      input.rating      ?? null,
      subject:     input.subject     ?? null,
      body:        input.body        ?? null,
      target_kind: input.target_kind ?? null,
      target_id:   input.target_id   ?? null,
      severity:    input.severity    ?? null,
      source:      'web',
    })
    .select('id, type, status, created_at')
    .single()

  if (insertErr || !row) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert failed' },
      { status: 500 },
    )
  }

  // Fire-and-don't-wait: Discord notification. If it fails (webhook
  // not configured, network blip) the user still gets their 200 — a
  // missing notification is never worth failing the submit on.
  void postSubmissionNotification(input, user.email ?? user.id, row.id).catch(() => {})

  return NextResponse.json({
    ok:         true,
    submission: row,
  })
}

async function postSubmissionNotification(
  input:  { type: string; subject?: string; body?: string; severity?: string; rating?: number; target_kind?: string; target_id?: string },
  who:    string,
  id:     string,
): Promise<void> {
  const isBug = input.type === 'bug'
  const isCritical = input.severity === 'critical' || input.severity === 'high'

  const color =
    isCritical              ? EMBED_COLOR.critical
    : input.type === 'bug'  ? EMBED_COLOR.warn
    : input.type === 'rating' && (input.rating ?? 0) >= 4 ? EMBED_COLOR.ok
    : EMBED_COLOR.info

  const title = input.subject
    ?? (input.type === 'rating'
          ? `${input.rating}★ rating`
          : `New ${TYPE_LABEL[input.type as 'rating' | 'question' | 'bug' | 'feature' | 'review']}`)

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Type', value: TYPE_LABEL[input.type as 'rating'] ?? input.type, inline: true },
    { name: 'From', value: who.slice(0, 100), inline: true },
  ]
  if (input.severity)    fields.push({ name: 'Severity', value: input.severity, inline: true })
  if (input.target_kind) fields.push({ name: 'Target',   value: `${input.target_kind}:${input.target_id ?? ''}`, inline: false })

  const description = (input.body ?? '').slice(0, 1500) || '_(no body)_'

  if (isBug) {
    await notify.bugReport('', { embed: { title, description, color, fields, timestamp: new Date().toISOString(), footer: { text: `feedback id: ${id.slice(0, 8)}` } } })
  } else {
    await notify.support('', { embed: { title, description, color, fields, timestamp: new Date().toISOString(), footer: { text: `feedback id: ${id.slice(0, 8)}` } } })
  }
}
