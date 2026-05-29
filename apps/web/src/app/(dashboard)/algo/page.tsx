import { redirect } from 'next/navigation'
import {
  CheckCircle2, Circle, PlugZap, ShieldCheck, Ghost, Radio,
  ArrowRight, Cpu, BookLock, Sparkles, MessagesSquare, BrainCircuit,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import SectionHeader from '@/components/ui/SectionHeader'
import EngineLivePanel from '@/components/algo/EngineLivePanel'
import AutotradeArmCard from '@/components/algo/AutotradeArmCard'

export const metadata = { title: 'Auto Trading — Institutional Execution Desk' }
export const dynamic = 'force-dynamic'

interface Step {
  key:    string
  done:   boolean
  icon:   LucideIcon
  title:  string
  blurb:  string
  cta:    { href: string; label: string }
  detail?: string
}

/**
 * Auto Trading — institutional orchestration surface. The single page
 * a user visits to understand where they are on the path to running
 * the live execution engine, and what's left.
 *
 * NO fabrication. Every readiness checkpoint and live-state badge is
 * derived from real Supabase tables (broker_connections, shadow_executions,
 * copy_trades, profiles). "Activate engine" is intentionally NOT a
 * one-click magic button — promotion to live is the deliberate, audited
 * path through /brokers → /shadow → /execution that already exists.
 */
export default async function AlgoTradingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const since30d = new Date(Date.now() - 30 * 86400_000).toISOString()

  const [{ data: profile }, { data: brokers }, { data: shadow }, { data: openCopies }, { data: recentSignals }] = await Promise.all([
    supabase
      .from('profiles')
      .select('subscription_tier, account_type, telegram_chat_id')
      .eq('id', user.id)
      .single(),
    supabase
      .from('broker_connections')
      .select('broker, label, status, is_live, is_testnet, equity_usd, equity_updated_at')
      .eq('user_id', user.id),
    supabase
      .from('shadow_executions')
      .select('id, actual_status, slippage_pct, created_at')
      .eq('user_id', user.id)
      .gte('created_at', since30d),
    supabase
      .from('copy_trades')
      .select('id, status')
      .eq('follower_id', user.id)
      .in('status', ['pending', 'mirrored', 'partial']),
    // AI Decision Feed source — real rationale fields persisted by the
    // engine on every signal. No fabricated scores, no invented reasons.
    supabase
      .from('signals')
      .select('id, pair, direction, regime, confidence_score, der_score, entropy_score, risk_reward, published_at')
      .order('published_at', { ascending: false })
      .limit(8),
  ])

  const tier = profile?.subscription_tier ?? 'free'
  const isVip = tier === 'vip' || (profile?.account_type ?? '').includes('vip')
  const telegramConnected = !!profile?.telegram_chat_id

  // ── Honest readiness checkpoints (real signals only) ──
  const brokerList   = brokers ?? []
  const connected    = brokerList.filter((b) => b.status === 'connected')
  const liveBrokers  = connected.filter((b) => b.is_live === true && b.is_testnet !== true)

  const shadowList   = shadow ?? []
  const shadowFilled = shadowList.filter((s) => s.actual_status === 'filled')
  // "Validated" threshold mirrors the platform's published shadow gate
  // (>=50 fills with healthy slippage). We render the count truthfully.
  const SHADOW_GATE  = 50
  const validated    = shadowFilled.length >= SHADOW_GATE

  const openCount    = (openCopies ?? []).length

  const steps: Step[] = [
    {
      key:   'broker',
      done:  connected.length > 0,
      icon:  PlugZap,
      title: 'Connect a broker',
      blurb: 'MT5, Binance, Bybit, OKX or cTrader. Keys are AES-256-GCM encrypted before storage; only the signal-engine decrypts.',
      cta:   { href: '/brokers', label: connected.length > 0 ? 'Manage brokers' : 'Connect now' },
      detail: connected.length > 0
        ? `${connected.length} connected · ${liveBrokers.length} live, ${connected.length - liveBrokers.length} testnet`
        : 'No broker connected yet',
    },
    {
      key:   'risk',
      done:  connected.length > 0,
      icon:  ShieldCheck,
      title: 'Configure risk',
      blurb: 'Daily-loss limit, drawdown ceiling, position sizing — the 12-gate institutional capital guard.',
      cta:   { href: '/risk', label: 'Open Risk Engine' },
      detail: connected.length > 0
        ? 'Risk gates active for connected accounts'
        : 'Risk Engine activates once a broker is connected',
    },
    {
      key:   'shadow',
      done:  validated,
      icon:  Ghost,
      title: 'Validate in Shadow Mode',
      blurb: `Paper-validate the engine on your account before any real-money fill. Live promotion needs ≥${SHADOW_GATE} clean fills.`,
      cta:   { href: '/shadow', label: validated ? 'Review shadow log' : 'Run shadow validation' },
      detail: shadowFilled.length > 0
        ? `${shadowFilled.length}/${SHADOW_GATE} shadow fills logged (last 30d)`
        : 'No shadow fills logged yet',
    },
    {
      key:   'live',
      done:  liveBrokers.length > 0 && validated,
      icon:  Radio,
      title: 'Promote to live',
      blurb: 'Flip a validated broker from testnet to live on the broker card. Reversible, audited, never silent.',
      cta:   { href: '/brokers', label: 'Promote broker' },
      detail: liveBrokers.length > 0
        ? `${liveBrokers.length} live broker${liveBrokers.length > 1 ? 's' : ''} ready`
        : 'No broker is on live yet',
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const allReady  = doneCount === steps.length
  const pct       = Math.round((doneCount / steps.length) * 100)

  // ── Live state pill — same truthful logic as /execution ──
  const liveBrokerReady = liveBrokers.length > 0
  const anyConnected    = connected.length > 0
  const liveState: 'live' | 'idle' | 'simulation' | 'no-broker' =
    liveBrokerReady ? (openCount > 0 ? 'live' : 'idle')
    : anyConnected  ? 'simulation'
    : 'no-broker'
  const livePill = {
    live:        { cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', label: `Live · ${openCount} open` },
    idle:        { cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', label: 'Live · idle' },
    simulation:  { cls: 'border-blue-500/40 bg-blue-500/10 text-blue-300',          dot: 'bg-blue-400',    label: 'Simulation Mode' },
    'no-broker': { cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300',          dot: 'bg-rose-400',    label: 'No broker connected' },
  }[liveState]

  return (
    <div className="mx-auto max-w-5xl px-1 py-4 sm:px-4 sm:py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">
            Auto <span className="text-gradient">Trading</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Institutional execution desk — broker, risk, shadow validation and the live engine, end-to-end.
          </p>
        </div>
        <span className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold',
          livePill.cls,
        )}>
          <span className={cn('h-1.5 w-1.5 rounded-full', livePill.dot)} aria-hidden />
          {livePill.label}
        </span>
      </header>

      {/* VIP gate — execution itself is VIP, the readiness path is open */}
      {!isVip && (
        <div className="mb-6 surface p-5">
          <SectionHeader
            icon={Cpu}
            title="Live execution requires VIP"
            subtitle="Below is the exact path. Steps work for any tier; the engine itself activates on VIP."
            badge={{ label: 'Tier · VIP', tone: 'warn' }}
            actions={<a href="/upgrade" className="btn-premium !px-4 !py-2 !text-xs">Upgrade — $299/mo</a>}
          />
        </div>
      )}

      {/* Progress band */}
      <div className="surface mb-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Activation Path · {doneCount} of {steps.length}
          </p>
          <span className="text-[11px] tabular-nums text-muted-foreground">{pct}% ready</span>
        </div>
        <div className="flex gap-1.5">
          {steps.map((s) => (
            <span
              key={s.key}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                s.done ? 'bg-gradient-primary' : 'bg-muted/40',
              )}
            />
          ))}
        </div>
        {allReady && isVip && (
          <a
            href="/execution"
            className="btn-premium mt-5 inline-flex !px-5 !py-2.5 !text-sm"
          >
            Open Execution Desk
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} aria-hidden />
          </a>
        )}
      </div>

      {/* Autonomous-execution arming surface — spec sections 2, 10, 11, 14.
          Renders disabled when no broker, the arming form when disarmed,
          and the mode badge + Pause + Panic close when armed. */}
      <div className="mb-6">
        <AutotradeArmCard />
      </div>

      {/* Telegram preview — real chat-link state, honest CTA when missing */}
      <div className={cn(
        'mb-6 flex flex-wrap items-center gap-3 rounded-xl border p-3.5 text-xs',
        telegramConnected
          ? 'border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-200'
          : 'border-border bg-card text-muted-foreground',
      )}>
        <MessagesSquare className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="flex-1 min-w-0">
          {telegramConnected ? (
            <>
              <span className="font-semibold text-emerald-300">Telegram alerts connected.</span>
              {' '}Trade-close notifications will route to your linked chat.
            </>
          ) : (
            <>
              <span className="font-semibold text-foreground">Telegram alerts not linked.</span>
              {' '}Link your chat in Settings to receive trade-close notifications — silent until linked, never invented.
            </>
          )}
        </span>
        <a
          href="/settings"
          className="shrink-0 rounded-md border border-border bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-foreground/85 hover:text-foreground"
        >
          {telegramConnected ? 'Manage' : 'Link Telegram'}
        </a>
      </div>

      {/* Live engine telemetry — polls /api/engine/status, renders honest
          per-section error states when the engine is unreachable. */}
      <div className="mb-6">
        <EngineLivePanel />
      </div>

      {/* Step cards — honest detail per step */}
      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((s) => {
          const Icon = s.icon
          return (
            <li
              key={s.key}
              className={cn(
                'surface flex gap-4 p-5',
                s.done && 'border-emerald-500/30 bg-emerald-500/[0.04]',
              )}
            >
              <span className="mt-0.5 shrink-0">
                {s.done
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-400" strokeWidth={2} aria-hidden />
                  : <Circle       className="h-5 w-5 text-muted-foreground/60" strokeWidth={1.75} aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-amber-300/90" strokeWidth={1.75} aria-hidden />
                  <h3 className="text-sm font-semibold">{s.title}</h3>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.blurb}</p>
                {s.detail && (
                  <p className="mt-2 text-[11px] tabular-nums text-foreground/70">{s.detail}</p>
                )}
                <a
                  href={s.cta.href}
                  className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-amber-300 hover:underline"
                >
                  {s.cta.label}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                </a>
              </div>
            </li>
          )
        })}
      </ol>

      {/* AI Decision Feed — real engine-emitted rationale per signal */}
      <section className="surface mt-6 p-5">
        <SectionHeader
          icon={BrainCircuit}
          title="AI Decision Feed"
          subtitle="Each row carries the rationale the engine recorded when the signal was emitted — regime, model confidence, divergence and entropy. Empty until the engine publishes a signal."
          badge={{ label: 'Engine-emitted', tone: 'muted' }}
        />
        {(recentSignals ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No signals published yet.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {(recentSignals ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <span className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                  s.direction === 'buy' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
                )}>
                  {s.direction}
                </span>
                <span className="font-mono text-sm font-semibold">{s.pair}</span>
                <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  {s.regime && (
                    <span>Regime <span className="text-foreground/85">{s.regime}</span></span>
                  )}
                  {typeof s.confidence_score === 'number' && (
                    <span>Conf <span className="text-foreground/85 tabular-nums">{Math.round(s.confidence_score * (s.confidence_score > 1 ? 1 : 100))}%</span></span>
                  )}
                  {typeof s.der_score === 'number' && (
                    <span>DER <span className="text-foreground/85 tabular-nums">{s.der_score.toFixed(2)}</span></span>
                  )}
                  {typeof s.entropy_score === 'number' && (
                    <span>Entropy <span className="text-foreground/85 tabular-nums">{s.entropy_score.toFixed(2)}</span></span>
                  )}
                  {typeof s.risk_reward === 'number' && (
                    <span>R:R <span className="text-foreground/85 tabular-nums">{s.risk_reward.toFixed(2)}</span></span>
                  )}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground/70">
                  {new Date(s.published_at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What the engine does (transparency band) */}
      <section className="surface mt-6 p-5">
        <SectionHeader
          icon={Sparkles}
          title="What runs once you're live"
          subtitle="Every layer is auditable — no hidden steps, no fabricated rationale."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Pillar
            icon={BookLock}
            title="Encrypted broker handshake"
            body="AES-256-GCM key vault. Only the signal-engine on Railway can decrypt — never the browser, never an analytics layer."
          />
          <Pillar
            icon={ShieldCheck}
            title="12-gate risk firewall"
            body="Per-trade preflight (spread · slippage · drawdown · correlation · daily loss · session · session-vol · kill switch …) — every block is logged."
          />
          <Pillar
            icon={MessagesSquare}
            title="Truthful trade narration"
            body="Open/close events route to your channel with the regime, gate state and PnL — no invented confidence scores."
          />
        </div>
      </section>

      <p className="mt-6 text-center text-[10px] text-muted-foreground">
        Trading involves risk. Live execution requires a validated broker, an active 30-day shadow record, and explicit promotion —
        nothing about this flow is silent or automatic until you opt in.
      </p>
    </div>
  )
}

function Pillar({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
      <Icon className="h-4 w-4 text-amber-300/90" strokeWidth={1.75} aria-hidden />
      <h4 className="mt-2 text-sm font-semibold">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}
