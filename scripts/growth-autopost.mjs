#!/usr/bin/env node
/**
 * Self-contained growth auto-poster.
 *
 * Renders a FRESH branded asset from REAL platform data and publishes it to
 * Telegram + Discord, recording each as a growth_content_item. Rotates content
 * type per run so the feed stays varied. No Vercel dependency — runnable from
 * any scheduler (cron, Railway job, agent loop).
 *
 *   node --env-file=apps/web/.env.local scripts/growth-autopost.mjs
 *
 * Reads channel destinations from the gitignored apps/web/.env.batch.local.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const env = Object.fromEntries(
  readFileSync(join(ROOT, 'apps/web/.env.batch.local'), 'utf8')
    .split('\n').filter(Boolean).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }),
)
const TOK = process.env.TELEGRAM_BOT_TOKEN
const TG = env.GROWTH_TELEGRAM_CHANNEL_ID
const db = createClient(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ── Gather REAL data ─────────────────────────────────────────────────────────
async function realData() {
  const { data: signals } = await db.from('signals')
    .select('pair,direction,entry_price,stop_loss,take_profit_1,risk_reward,confidence_score,result,status,published_at')
    .order('published_at', { ascending: false }).limit(200)
  const s = signals || []
  const wins = s.filter((x) => x.result === 'win').length
  const losses = s.filter((x) => x.result === 'loss').length
  const closed = wins + losses
  const winRate = closed > 0 ? Math.round((wins / closed) * 100) : null
  const latest = s.find((x) => x.status === 'active') || s[0] || null
  return { signals: s, wins, losses, closed, winRate, latest }
}

// Rotating educational tips + feature highlights (varied feed).
const TIPS = [
  ['Risk per trade', 'Never risk more than 1–2% of account on a single idea. Survival first, profit second.'],
  ['The 1R rule', 'Define your stop before entry. Size the position so the stop equals 1R — then let winners run.'],
  ['Process over PnL', 'A good trade can lose; a bad trade can win. Grade the decision, not the outcome.'],
  ['Trade your plan', 'If a setup is not in your playbook, it is not a trade — it is a gamble.'],
]
const FEATURES = [
  ['AI Coach', 'Real-time trade reviews + risk & discipline scoring on every trade.'],
  ['Risk Engine', '15 institutional capital gates + kill switch protect every position.'],
  ['Signal Engine', 'Regime-adaptive ensemble across 28 symbols, fully transparent.'],
  ['Trade Journal', 'Two-mode behavioral intelligence — learn from every execution.'],
]

// ── Select content for THIS run (rotation by hour, avoids repeating last) ─────
async function selectContent(d) {
  const slot = Math.floor(Date.now() / (1000 * 60 * 60)) % 4
  const pickIdx = Math.floor(Date.now() / (1000 * 60 * 60 * 24))
  const { data: last } = await db.from('growth_content_items')
    .select('title').eq('provenance->>source', 'autopost').order('created_at', { ascending: false }).limit(1)
  const lastTitle = last?.[0]?.title

  const candidates = []
  if (d.latest) candidates.push({
    variant: 'signal', kind: 'market_report',
    payload: { pair: d.latest.pair, direction: d.latest.direction || 'buy', entry: d.latest.entry_price,
      stop_loss: d.latest.stop_loss, take_profit: d.latest.take_profit_1, risk_reward: d.latest.risk_reward,
      confidence: d.latest.confidence_score || 75 },
    title: `${d.latest.pair} Setup`,
    caption: `📊 ${d.latest.pair} — ${(d.latest.direction || 'buy').toUpperCase()} @ ${d.latest.entry_price} · SL ${d.latest.stop_loss} · TP ${d.latest.take_profit_1}${d.latest.risk_reward ? ` · R:R ${d.latest.risk_reward}` : ''}.\nEducational, not financial advice. → AlgoSphere`,
  })
  if (d.winRate != null) candidates.push({
    variant: 'achievement', kind: 'announcement',
    payload: { achievement: `${d.winRate}% Win Rate`, description: `${d.wins} wins / ${d.losses} losses across ${d.closed} closed signals — verified.` },
    title: `${d.winRate}% Verified Win Rate`,
    caption: `✅ ${d.winRate}% verified win rate — ${d.wins}W / ${d.losses}L across ${d.closed} closed signals. Transparency first. → AlgoSphere`,
  })
  const tip = TIPS[pickIdx % TIPS.length]
  candidates.push({
    variant: 'feature', kind: 'educational',
    payload: { feature: tip[0], description: tip[1] },
    title: `Tip: ${tip[0]}`,
    caption: `💡 ${tip[0]} — ${tip[1]} → AlgoSphere`,
  })
  const feat = FEATURES[pickIdx % FEATURES.length]
  candidates.push({
    variant: 'feature', kind: 'product_update',
    payload: { feature: feat[0], description: feat[1] },
    title: `Feature: ${feat[0]}`,
    caption: `🤖 ${feat[0]} — ${feat[1]} → AlgoSphere`,
  })

  // Pick by slot, skip if identical to last post.
  const ordered = [candidates[slot % candidates.length], ...candidates]
  return ordered.find((c) => c.title !== lastTitle) || ordered[0]
}

// ── Render via the Python producer ───────────────────────────────────────────
function render(c) {
  const out = join(tmpdir(), 'algo_autopost'); mkdirSync(out, { recursive: true })
  const item = JSON.stringify({ kind: 'signal_card', provenance: { payload: c.payload } })
  const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("sc", "apps/asset-worker/producers/signal_card.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
item = json.loads(sys.argv[1]); out = __import__("pathlib").Path(sys.argv[2])
res = m.produce(item, out, "autopost")
print(list(res.values())[0])
`
  const path = execFileSync('python', ['-c', py, item, out], { encoding: 'utf8' }).trim().split('\n').pop().trim()
  return readFileSync(path)
}

// ── Publish ──────────────────────────────────────────────────────────────────
async function main() {
  const d = await realData()
  const c = await selectContent(d)
  const bytes = render(c)
  const path = `autopost/${Date.now()}_${c.variant}.jpg`
  const up = await db.storage.from('growth-assets').upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
  if (up.error) throw new Error('upload: ' + up.error.message)
  const url = db.storage.from('growth-assets').getPublicUrl(path).data.publicUrl

  const tg = await (await fetch(`https://api.telegram.org/bot${TOK}/sendPhoto`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TG, photo: url, caption: c.caption }),
  })).json()

  const webhooks = {
    market_report: env.DISCORD_WEBHOOK_SIGNALS_FREE_URL || env.DISCORD_WEBHOOK_MARKET_INTEL_URL,
    announcement: env.DISCORD_WEBHOOK_ANNOUNCEMENTS_URL,
    educational: env.DISCORD_WEBHOOK_EDUCATION_URL,
    product_update: env.DISCORD_WEBHOOK_GENERAL_URL,
  }
  const wh = webhooks[c.kind] || env.DISCORD_WEBHOOK_GENERAL_URL
  let dc = '(none)'
  if (wh) {
    const r = await fetch(wh, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ embeds: [{ description: c.caption, image: { url } }] }) })
    dc = r.status === 204 || r.ok ? 'OK' : 'ERR ' + r.status
  }

  await db.from('growth_content_items').insert({
    kind: c.kind, status: 'published', title: c.title, summary: c.caption.slice(0, 140),
    body_md: c.caption, hero_image_url: url, channels: ['telegram', 'discord'], tags: ['autopost'],
    is_synthetic: false, disclaimer: 'Educational content. Not financial advice.',
    published_at: new Date().toISOString(), asset_state: 'ready', asset_urls: [url],
    provenance: { source: 'autopost', variant: c.variant, posted: true },
  })

  console.log(`autopost: ${c.title} → TG:${tg.ok ? 'msg ' + tg.result.message_id : 'ERR'} | Discord:${dc}`)
}
main().catch((e) => { console.error('autopost FAILED:', e.message); process.exit(1) })
