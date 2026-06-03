/**
 * /api/cron/growth-copilot — daily Copilot brief generator.
 *
 * Schedule: 09:30 UTC. Auth Bearer ${CRON_SECRET}. After generation,
 * pings the Discord admin channel with the headline + top action so
 * the operator sees the brief landed without opening the dashboard.
 */
import { NextResponse } from 'next/server'
import { generateCopilotBrief } from '@/lib/growth/copilot'
import { notify, EMBED_COLOR } from '@/lib/notifications/discord'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let brief
  try {
    brief = await generateCopilotBrief()
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }

  // Discord admin ping — fire-and-forget. Surfaces today's headline
  // bottleneck + top action in the #admin channel.
  const top = brief.actions[0]
  const f   = brief.signals.funnel
  notify.admin(
    '📊 **Growth Copilot — daily brief**',
    {
      embed: {
        title:       'Daily Growth Copilot',
        description: top ? `**${top.title}** (${top.impact})\n${top.why}` : 'No outlier actions this window.',
        color:       top?.impact === 'high' ? EMBED_COLOR.warn : EMBED_COLOR.info,
        fields: [
          { name: 'Visitors → Signups', value: `${f.visitors.toLocaleString()} → ${f.signups}`,         inline: true },
          { name: 'Signups → Brokers',  value: `${f.signups} → ${f.broker_connected}`,                  inline: true },
          { name: 'Brokers → Trades',   value: `${f.broker_connected} → ${f.trade_synced}`,             inline: true },
          { name: 'Trades → Premium',   value: `${f.trade_synced} → ${f.premium_upgrade}`,              inline: true },
        ],
        footer:    { text: `Window ${brief.window_start.slice(0,10)} → ${brief.window_end.slice(0,10)}` },
        timestamp: new Date().toISOString(),
      },
    },
  ).catch(() => {})

  return NextResponse.json({
    fired_at:    new Date().toISOString(),
    window:      `${brief.window_start.slice(0,10)} → ${brief.window_end.slice(0,10)}`,
    actions:     brief.actions.length,
    model:       brief.model,
  })
}

export const POST = GET
