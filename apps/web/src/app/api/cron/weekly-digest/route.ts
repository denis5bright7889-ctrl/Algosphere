/**
 * /api/cron/weekly-digest — Monday-morning newsletter blast.
 *
 * Daily at 09:00 UTC; self-gates to Monday only. For every
 * newsletter_subscribers row with status='subscribed', sends a
 * Resend email summarising the past 7 days. Uses the latest
 * growth_copilot_briefs row (if any) for the intro paragraph;
 * otherwise re-aggregates fresh signals.
 *
 * Rate: paced at ~3 emails / sec to stay inside Resend free tier
 * (3k/month) and well under their per-second cap. For a list of
 * 1000 subscribers, the cron completes in ~6 minutes.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { generateCopilotBrief, type CopilotSignals } from '@/lib/growth/copilot'
import { sendWeeklyDigest } from '@/lib/email/weekly-digest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300   // 5 min — covers ~900 subs at 3/s

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`
}

const SUBSCRIBER_LIMIT = 5_000
const SEND_PACE_MS     = 350     // ~3/sec

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  if (now.getUTCDay() !== 1) {
    return NextResponse.json({ skipped: 'not_monday', utc_day: now.getUTCDay() })
  }

  const db = svc()

  // 1. Pull latest copilot brief (or generate one if none exists). We
  //    re-use its signals so the email + admin dashboard agree.
  const { data: latest } = await db
    .from('growth_copilot_briefs')
    .select('window_start, window_end, signals, summary_md, generated_at')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let signals:   CopilotSignals | null = null
  let summaryMd: string | null         = null

  const briefAgeMs = latest?.generated_at
    ? Date.now() - new Date(latest.generated_at).getTime()
    : Number.POSITIVE_INFINITY

  if (latest && briefAgeMs < 36 * 3600_000) {
    signals   = latest.signals as CopilotSignals
    summaryMd = latest.summary_md
  } else {
    // Generate fresh brief; this also persists a row.
    try {
      const fresh = await generateCopilotBrief()
      signals   = fresh.signals
      summaryMd = fresh.summary_md
    } catch (e) {
      return NextResponse.json({
        error: e instanceof Error ? e.message : 'failed to generate signals',
      }, { status: 500 })
    }
  }

  if (!signals) {
    return NextResponse.json({ error: 'no signals' }, { status: 500 })
  }

  // 2. Pull subscriber list.
  const { data: subs } = await db
    .from('newsletter_subscribers')
    .select('email')
    .eq('status', 'subscribed')
    .order('confirmed_at', { ascending: false })
    .limit(SUBSCRIBER_LIMIT)

  const rows = (subs ?? []) as Array<{ email: string }>

  // 3. Send. Sequential with a small pace to respect provider limits.
  let sent   = 0
  let failed = 0
  for (const r of rows) {
    const out = await sendWeeklyDigest({
      to:        r.email,
      signals,
      summaryMd,
    })
    if (out.ok) sent += 1; else failed += 1
    if (rows.length > 1) await new Promise(res => setTimeout(res, SEND_PACE_MS))
  }

  return NextResponse.json({
    fired_at:    new Date().toISOString(),
    window:      `${signals.window_start.slice(0,10)} → ${signals.window_end.slice(0,10)}`,
    subscribers: rows.length,
    sent,
    failed,
  })
}

export const POST = GET
