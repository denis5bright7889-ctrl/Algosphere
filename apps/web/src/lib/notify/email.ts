/**
 * AlgoSphere Quant — Transactional email via Resend (free tier 3k/mo).
 *
 * Used for: trade reviews, prop firm breach alerts, payment confirmations,
 * trial expiry, weekly digests. Never used for marketing without opt-in.
 */

import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/server'

const API_KEY = process.env.RESEND_API_KEY
const FROM    = process.env.RESEND_FROM ?? 'AlgoSphere <noreply@resend.dev>'

const resend = API_KEY ? new Resend(API_KEY) : null

export function isEmailAvailable(): boolean {
  return !!resend
}

export interface EmailPayload {
  to:       string
  subject:  string
  html:     string
  text?:    string
  // Logging tags
  eventType?: string
  userId?:    string
}

/**
 * Send one email. Returns provider id on success, logs to notification_log.
 */
export async function sendEmail(p: EmailPayload): Promise<{ id: string | null; ok: boolean }> {
  if (!resend) return { id: null, ok: false }

  try {
    const { data, error } = await resend.emails.send({
      from:    FROM,
      to:      p.to,
      subject: p.subject,
      html:    p.html,
      text:    p.text,
    })
    if (error) throw error

    if (p.userId) {
      const svc = createServiceClient()
      await svc.from('notification_log').insert({
        user_id:      p.userId,
        channel:      'email',
        event_type:   p.eventType ?? 'generic',
        subject:      p.subject,
        body:         p.text ?? p.html.slice(0, 500),
        status:       'sent',
        provider_ref: data?.id ?? null,
      }).then(() => {}, () => {})
    }
    return { id: data?.id ?? null, ok: true }
  } catch (err) {
    console.error('Email send failed:', err)
    if (p.userId) {
      const svc = createServiceClient()
      await svc.from('notification_log').insert({
        user_id:    p.userId,
        channel:    'email',
        event_type: p.eventType ?? 'generic',
        subject:    p.subject,
        status:     'failed',
        error_msg:  String(err).slice(0, 500),
      }).then(() => {}, () => {})
    }
    return { id: null, ok: false }
  }
}

// ─── Templates ───────────────────────────────────────────────────────

const SHELL = (content: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
  body { font: 14px/1.6 -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e8e0d0; margin: 0; padding: 24px; }
  .card { max-width: 560px; margin: 0 auto; background: #141210; border: 1px solid #2e2820; border-radius: 16px; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 16px; color: #D4A017; }
  a.btn { display: inline-block; background: linear-gradient(135deg, #D4A017, #f4c247); color: #0a0a0a; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 13px; margin-top: 16px; }
  .muted { color: #a89880; font-size: 12px; }
  hr { border: 0; border-top: 1px solid #2e2820; margin: 24px 0; }
</style></head><body><div class="card">${content}</div></body></html>`

export function tradeReviewEmail(args: {
  to: string; pair: string; grade: string; score: number; summary: string; appUrl: string
}): EmailPayload {
  return {
    to: args.to,
    subject: `[${args.grade}] AI review of your ${args.pair} trade`,
    html: SHELL(`
      <h1>Your trade was reviewed</h1>
      <p><strong>${args.pair}</strong> — Grade <strong>${args.grade}</strong> · Score <strong>${args.score}/100</strong></p>
      <p>${args.summary}</p>
      <a class="btn" href="${args.appUrl}/dashboard/journal">View Full Review</a>
      <hr>
      <p class="muted">You're receiving this because AI reviews are enabled in your alert preferences.</p>
    `),
    text: `${args.pair} — ${args.grade} (${args.score}/100)\n\n${args.summary}\n\n${args.appUrl}/dashboard/journal`,
    eventType: 'trade_review',
  }
}

export function propBreachEmail(args: {
  to: string; firm: string; breachType: string; appUrl: string
}): EmailPayload {
  return {
    to: args.to,
    subject: `⚠ ${args.firm} challenge — ${args.breachType} limit reached`,
    html: SHELL(`
      <h1>Stop trading this account</h1>
      <p>Your ${args.firm} challenge has reached the <strong>${args.breachType}</strong> drawdown limit.</p>
      <p>Continuing to trade now will fail the challenge. Step away, review the journal, return tomorrow with a plan.</p>
      <a class="btn" href="${args.appUrl}/dashboard/prop">View Compliance Status</a>
    `),
    text: `${args.firm} ${args.breachType} limit reached. Stop trading.\n${args.appUrl}/dashboard/prop`,
    eventType: 'prop_breach',
  }
}

export function signalAlertEmail(args: {
  to: string; pair: string; direction: string; entry: number; sl: number; tp: number; appUrl: string
}): EmailPayload {
  const isBuy = args.direction === 'buy'
  return {
    to: args.to,
    subject: `${isBuy ? '🟢' : '🔴'} ${args.pair} ${args.direction.toUpperCase()} signal`,
    html: SHELL(`
      <h1>${isBuy ? 'Buy' : 'Sell'} ${args.pair}</h1>
      <p>Entry: <strong>${args.entry}</strong></p>
      <p>Stop Loss: <strong>${args.sl}</strong></p>
      <p>Take Profit: <strong>${args.tp}</strong></p>
      <a class="btn" href="${args.appUrl}/dashboard/signals">View Signal</a>
    `),
    text: `${args.direction.toUpperCase()} ${args.pair} @ ${args.entry} (SL ${args.sl} / TP ${args.tp})`,
    eventType: 'signal_alert',
  }
}
