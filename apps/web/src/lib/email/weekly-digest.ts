/**
 * Weekly Intelligence Digest — Monday-morning email summarising the
 * past 7 days of platform activity for newsletter subscribers.
 *
 * Reuses the Copilot signals aggregator so the email never claims a
 * number that disagrees with the admin dashboard. Sent via Resend.
 *
 * Honesty contract:
 *   - Every numeric claim in the email body is computed deterministic-
 *     ally from the signals payload (no LLM body).
 *   - The summary is sourced from the latest growth_copilot_briefs
 *     row when available; otherwise a deterministic two-paragraph
 *     fallback runs off the signals alone.
 */
import { sendEmail, isEmailAvailable } from '@/lib/notify/email'
import type { CopilotSignals } from '@/lib/growth/copilot'

const PUBLIC_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://algospherequant.com'
const CONTACT    = 'rena20mez@gmail.com'

export interface DigestPayload {
  to:          string
  signals:     CopilotSignals
  /** Optional LLM-written intro from the latest Copilot brief. */
  summaryMd?:  string | null
}

export async function sendWeeklyDigest(p: DigestPayload): Promise<{ ok: boolean; id: string | null }> {
  if (!isEmailAvailable()) return { ok: false, id: null }

  const f = p.signals.funnel
  const dayStart = p.signals.window_start.slice(0, 10)
  const dayEnd   = p.signals.window_end.slice(0, 10)

  const subject = `AlgoSphere Weekly Intelligence — ${dayEnd}`

  const summaryHtml = (p.summaryMd ?? deterministicIntro(p.signals))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\n/g, '<br/>')

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;color:#e5e5e5;font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#111;border:1px solid #222;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 8px;">
              <div style="font-size:11px;letter-spacing:.18em;font-weight:700;color:#fbbf24;text-transform:uppercase;">AlgoSphere Weekly</div>
              <h1 style="margin:12px 0 0;font-size:22px;color:#fafafa;">Intelligence digest · ${dayStart} → ${dayEnd}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 16px;color:#d4d4d8;font-size:14px;">
              <p>${summaryHtml}</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 8px;">
              <p style="margin:14px 0 8px;font-size:11px;letter-spacing:.16em;font-weight:700;color:#fbbf24;text-transform:uppercase;">By the numbers</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:#e5e5e5;">
                ${row('Visitors',          f.visitors.toLocaleString())}
                ${row('New signups',       f.signups.toString())}
                ${row('Broker connections',f.broker_connected.toString())}
                ${row('First trades',      f.trade_synced.toString())}
                ${row('Premium upgrades',  f.premium_upgrade.toString())}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 24px;">
              <p style="margin:18px 0 8px;font-size:11px;letter-spacing:.16em;font-weight:700;color:#fbbf24;text-transform:uppercase;">Conversion</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:#e5e5e5;">
                ${row('Visitor → signup',  pct(f.conv.visitor_to_signup))}
                ${row('Signup → broker',   pct(f.conv.signup_to_broker))}
                ${row('Broker → trade',    pct(f.conv.broker_to_trade))}
                ${row('Trade → premium',   pct(f.conv.trade_to_premium))}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 28px;">
              <a href="${PUBLIC_URL}/blog" style="display:inline-block;background:#fbbf24;color:#000;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:10px;font-size:13px;">Read this week&rsquo;s research →</a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#0a0a0a;border-top:1px solid #1f1f1f;color:#71717a;font-size:11px;">
              <p style="margin:0;">You&rsquo;re receiving this because you subscribed to AlgoSphere Weekly. <a href="${PUBLIC_URL}/api/newsletter/unsubscribe?email=${encodeURIComponent(p.to)}" style="color:#71717a;text-decoration:underline;">Unsubscribe</a>.</p>
              <p style="margin:8px 0 0;">Trading involves risk of loss. Past performance is not indicative of future results. Questions: <a href="mailto:${CONTACT}" style="color:#71717a;">${CONTACT}</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()

  const text = [
    `AlgoSphere Weekly Intelligence — ${dayStart} → ${dayEnd}`,
    '',
    (p.summaryMd ?? deterministicIntro(p.signals)).replace(/<[^>]+>/g, ''),
    '',
    'By the numbers:',
    `  Visitors:           ${f.visitors.toLocaleString()}`,
    `  New signups:        ${f.signups}`,
    `  Broker connections: ${f.broker_connected}`,
    `  First trades:       ${f.trade_synced}`,
    `  Premium upgrades:   ${f.premium_upgrade}`,
    '',
    'Conversion:',
    `  Visitor → signup:  ${pct(f.conv.visitor_to_signup)}`,
    `  Signup → broker:   ${pct(f.conv.signup_to_broker)}`,
    `  Broker → trade:    ${pct(f.conv.broker_to_trade)}`,
    `  Trade → premium:   ${pct(f.conv.trade_to_premium)}`,
    '',
    `Read this week's research: ${PUBLIC_URL}/blog`,
    '',
    'Trading involves risk of loss. Past performance is not indicative of future results.',
    `Unsubscribe: ${PUBLIC_URL}/api/newsletter/unsubscribe?email=${encodeURIComponent(p.to)}`,
  ].join('\n')

  return sendEmail({
    to:        p.to,
    subject,
    html,
    text,
    eventType: 'newsletter.weekly_digest',
  })
}

function deterministicIntro(s: CopilotSignals): string {
  const f = s.funnel
  if (f.visitors === 0 && f.signups === 0) {
    return 'A quiet week on the platform — no significant funnel activity to report. The intelligence engine continues to publish signals and grade strategies; we&rsquo;ll have more numbers to share next week.'
  }
  return `${f.visitors.toLocaleString()} visitors landed on AlgoSphere this week, ${f.signups} signed up, and ${f.broker_connected} connected a broker. ${f.trade_synced} placed a first trade. The signal engine and the journal intelligence layer kept running through the window — the bottleneck right now is ${weakestStage(f.conv)}.`
}

function weakestStage(conv: CopilotSignals['funnel']['conv']): string {
  const entries: Array<[string, number | null]> = [
    ['visitor → signup',  conv.visitor_to_signup],
    ['signup → broker',   conv.signup_to_broker],
    ['broker → trade',    conv.broker_to_trade],
    ['trade → premium',   conv.trade_to_premium],
  ]
  const valid = entries.filter((e): e is [string, number] => typeof e[1] === 'number')
  if (valid.length === 0) return 'funnel data is still thin'
  valid.sort((a, b) => a[1] - b[1])
  const [stage, rate] = valid[0]!
  return `${stage} at ${pct(rate)}`
}

function pct(v: number | null): string {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}
function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:4px 0;color:#a1a1aa;">${escapeHtml(label)}</td>
    <td style="padding:4px 0;text-align:right;font-weight:700;color:#fafafa;font-variant-numeric:tabular-nums;">${escapeHtml(value)}</td>
  </tr>`
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
