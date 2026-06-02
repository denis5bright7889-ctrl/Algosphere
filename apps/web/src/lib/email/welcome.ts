/**
 * Welcome email — fired once when a new lead lands or a new user
 * signs up. Idempotent at the call site (the route stamps
 * `leads.welcome_sent_at` so re-submissions don't re-send).
 *
 * Plain-HTML inline template (no React Email / MJML dep) to keep the
 * dependency surface tight. Marketing-grade visuals belong in the
 * growth_content_items workflow, not transactional mail.
 */
import { sendEmail, isEmailAvailable } from '@/lib/notify/email'

const PUBLIC_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://algospherequant.com'
const CONTACT    = 'rena20mez@gmail.com'

export interface WelcomeEmailInput {
  to:           string
  /** Optional display name from the form / profile. */
  name?:        string | null
  /** Tracks why the welcome was sent (so the audit log + Resend tags
   *  match the acquisition channel). */
  eventType:    'lead.welcome' | 'newsletter.welcome' | 'signup.welcome'
  /** When set, links the email back to the right user in the
   *  notification_log. */
  userId?:      string
}

export async function sendWelcomeEmail(p: WelcomeEmailInput): Promise<{ ok: boolean; id: string | null }> {
  if (!isEmailAvailable()) return { ok: false, id: null }

  const greeting = p.name?.trim() ? `Hi ${p.name.trim()},` : 'Hey there,'
  const subject  = 'Welcome to AlgoSphere — your edge starts here'

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
              <div style="font-size:11px;letter-spacing:.18em;font-weight:700;color:#fbbf24;text-transform:uppercase;">AlgoSphere Quant</div>
              <h1 style="margin:12px 0 0;font-size:22px;color:#fafafa;">Welcome to AlgoSphere — your edge starts here</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px;color:#d4d4d8;font-size:15px;">
              <p>${escapeHtml(greeting)}</p>
              <p>You're in. AlgoSphere is the AI-powered Trader Intelligence OS — every feature is unlocked on the Starter plan during launch:</p>
              <ul style="padding-left:18px;color:#e5e5e5;">
                <li>AI signals across forex, crypto, metals + commodities</li>
                <li>Behavioral Trade Journal (5 process grades + AI insights per trade)</li>
                <li>Trader Intelligence dashboard (AI Trader Score)</li>
                <li>Strategy Lab — Quant Builder, Backtester, Optimization Center</li>
                <li>Smart-money, whale, sentiment, and on-chain intelligence</li>
                <li>Automated execution + 15-gate institutional risk system</li>
              </ul>
              <p style="margin-top:24px;">Three things to do first:</p>
              <ol style="padding-left:18px;color:#e5e5e5;">
                <li><strong>Connect a broker</strong> — paper or live, your choice.</li>
                <li><strong>Run a backtest</strong> in the Quant Builder.</li>
                <li><strong>Log a trade</strong> to see the Behavioral Journal grade it across 5 process axes.</li>
              </ol>
              <p style="margin-top:28px;">
                <a href="${PUBLIC_URL}/overview" style="display:inline-block;background:#fbbf24;color:#000;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px;font-size:14px;">Open AlgoSphere →</a>
              </p>
              <p style="margin-top:24px;color:#a1a1aa;font-size:13px;">
                Questions? Reply to this email or hit us at <a href="mailto:${CONTACT}" style="color:#fbbf24;">${CONTACT}</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background:#0a0a0a;border-top:1px solid #1f1f1f;color:#71717a;font-size:11px;">
              <p style="margin:0;">Trading involves risk of loss. Past performance is not indicative of future results.</p>
              <p style="margin:8px 0 0;">AlgoSphere Quant · <a href="${PUBLIC_URL}" style="color:#71717a;">algospherequant.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()

  const text = [
    greeting,
    '',
    'You\'re in. AlgoSphere is the AI-powered Trader Intelligence OS — every feature is unlocked on the Starter plan during launch:',
    '',
    '  • AI signals across forex, crypto, metals + commodities',
    '  • Behavioral Trade Journal (5 process grades + AI insights per trade)',
    '  • Trader Intelligence dashboard (AI Trader Score)',
    '  • Strategy Lab — Quant Builder, Backtester, Optimization Center',
    '  • Smart-money, whale, sentiment, and on-chain intelligence',
    '  • Automated execution + 15-gate institutional risk system',
    '',
    'Three things to do first:',
    '  1. Connect a broker (paper or live).',
    '  2. Run a backtest in the Quant Builder.',
    '  3. Log a trade to see the Behavioral Journal grade it.',
    '',
    `Open AlgoSphere: ${PUBLIC_URL}/overview`,
    '',
    `Questions? Reply to this email or hit ${CONTACT}.`,
    '',
    '— AlgoSphere Quant',
    '',
    'Trading involves risk of loss. Past performance is not indicative of future results.',
  ].join('\n')

  return sendEmail({
    to:        p.to,
    subject,
    html,
    text,
    eventType: p.eventType,
    userId:    p.userId,
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
