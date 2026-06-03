'use client'

/**
 * Broker Access panel — the operational gateway between AlgoSphere and the
 * trader's brokerage accounts, rendered prominently on /overview.
 *
 * Goal (from the Broker Access spec): let traders reach a connected broker —
 * its official client portal and its trading platform — in one click, without
 * leaving AlgoSphere or hunting for the broker's website.
 *
 * Honesty contract (matches the rest of the codebase): every metric shown is
 * read from the user's own `broker_connections` row. We surface exactly what
 * the schema stores — equity, connection status, last sync — and do NOT invent
 * balance/margin/free-margin/floating-P&L/open-position numbers the platform
 * does not yet track. Account access (portal + platform links) is the genuinely
 * new capability and comes from the static `broker-portals` registry.
 *
 * Client component because the per-broker "Refresh sync" action re-pings the
 * engine handshake via /api/brokers/[id]/test and updates the card in place.
 */

import { useState, useTransition } from 'react'
import {
  Landmark, ExternalLink, RefreshCw, BarChart3, BookOpen, Settings2,
  Activity, ArrowRight, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolvePortal, METATRADER } from '@/lib/broker-portals'

export interface BrokerConn {
  id:                string
  broker:            string
  label:             string | null
  account_id:        string | null
  is_live:           boolean
  is_testnet:        boolean
  status:            string
  equity_usd:        number | null
  equity_updated_at: string | null
  last_synced_at:    string | null
  /** MT5 only: web-terminal deep link with server/login pre-filled. Built
   *  server-side (server + login decrypted there); absent when unavailable. */
  mt5WebUrl?:        string | null
}

type Health = 'connected' | 'pending' | 'attention' | 'disconnected'

function healthOf(c: BrokerConn): Health {
  if (c.status === 'failed' || c.status === 'error' || c.status === 'disconnected' || c.status === 'revoked') return 'disconnected'
  if (c.status === 'disabled') return 'attention'
  if (c.status === 'pending' || c.status === 'testing') return 'pending'
  if (c.status !== 'connected') return 'attention'
  // Connected but the equity feed has gone quiet → "Sync delayed".
  const stamp = c.equity_updated_at ?? c.last_synced_at
  if (stamp) {
    const ageMin = (Date.now() - new Date(stamp).getTime()) / 60_000
    if (ageMin > 120) return 'attention'
  }
  return 'connected'
}

const HEALTH_META: Record<Health, { dot: string; text: string; label: string }> = {
  connected:    { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Connected' },
  pending:      { dot: 'bg-sky-400',     text: 'text-sky-300',     label: 'Connecting' },
  attention:    { dot: 'bg-amber-400',   text: 'text-amber-300',   label: 'Needs attention' },
  disconnected: { dot: 'bg-rose-400',    text: 'text-rose-300',    label: 'Disconnected' },
}

function accountType(c: BrokerConn): string {
  if (c.broker === 'paper') return 'Paper'
  if (c.is_live) return 'Live'
  if (c.is_testnet) return 'Demo / Testnet'
  return 'Account'
}

function syncAge(stamp: string | null): string {
  if (!stamp) return 'no sync yet'
  const ageMin = (Date.now() - new Date(stamp).getTime()) / 60_000
  if (ageMin < 1)    return 'just now'
  if (ageMin < 60)   return `${Math.round(ageMin)}m ago`
  if (ageMin < 1440) return `${Math.round(ageMin / 60)}h ago`
  return `${Math.round(ageMin / 1440)}d ago`
}

function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`
}

export default function BrokerAccessPanel({ initial }: { initial: BrokerConn[] }) {
  const [conns, setConns] = useState<BrokerConn[]>(initial)

  function patch(updated: BrokerConn) {
    setConns((arr) => arr.map((c) => (c.id === updated.id ? updated : c)))
  }

  const connectedCount = conns.filter((c) => healthOf(c) === 'connected').length

  return (
    <section className="surface mb-5 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-semibold">Broker Access</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {connectedCount} of {conns.length} connected
          </span>
          <a
            href="/brokers"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300/85 hover:text-amber-300 hover:underline"
          >
            Manage <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
          </a>
        </div>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Quick access to your connected trading accounts — open the broker portal or
        platform without leaving AlgoSphere.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {conns.map((c) => (
          <BrokerCard key={c.id} c={c} onPatch={patch} />
        ))}
      </div>
    </section>
  )
}

function BrokerCard({ c, onPatch }: { c: BrokerConn; onPatch: (c: BrokerConn) => void }) {
  const [pending, startTransition] = useTransition()
  const [syncErr, setSyncErr] = useState<string | null>(null)

  const portal = resolvePortal(c.broker, [c.label, c.account_id])
  const health = healthOf(c)
  const hm = HEALTH_META[health]
  const lastSync = syncAge(c.equity_updated_at ?? c.last_synced_at)

  // Re-ping the engine handshake; reuses the same endpoint the /brokers
  // page uses for "Retry connection". Disabled/revoked rows are read-only.
  const canRefresh = c.status !== 'disabled' && c.status !== 'revoked' && c.broker !== 'paper'
  function refresh() {
    if (!canRefresh) return
    setSyncErr(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/brokers/${c.id}/test`, { method: 'POST' })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) { setSyncErr(d.error ?? 'engine unreachable'); return }
        if (d.connection) onPatch({ ...c, ...d.connection })
      } catch {
        setSyncErr('Network error')
      }
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Header: logo · name · account · status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-[11px] font-bold',
              portal.badge,
            )}
            aria-hidden
          >
            {portal.monogram}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-tight">
              {portal.name}
              {c.label && <span className="ml-1 font-normal text-muted-foreground">· {c.label}</span>}
            </h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="rounded bg-background/60 px-1.5 py-px font-medium">{accountType(c)}</span>
              {c.account_id && <span className="font-mono">#{c.account_id}</span>}
            </p>
          </div>
        </div>
        <span className={cn('flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider', hm.text)}>
          <span className={cn('inline-block h-2 w-2 rounded-full', hm.dot)} aria-hidden />
          {hm.label}
        </span>
      </div>

      {/* Metrics we actually store: equity + last sync. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Equity" value={fmtUsd(c.equity_usd)} />
        <Metric label="Last sync" value={lastSync} sub icon={Activity} />
      </div>

      {syncErr && <p className="mt-2 text-[11px] text-rose-400">Sync failed: {syncErr}</p>}

      {/* Access: portal + platform launch. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {portal.portalUrl ? (
          <LinkButton href={portal.portalUrl} icon={ExternalLink} primary>
            Open Broker Portal
          </LinkButton>
        ) : c.broker === 'paper' ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            Simulated account — no external portal
          </span>
        ) : null}

        {portal.isMetaTrader ? (
          <>
            {/* Deep link pre-selects the broker server (+ login) so the user
                only types their password — MT5 never logs in with an email. */}
            <LinkButton href={c.mt5WebUrl ?? METATRADER.mt5Web} icon={ExternalLink}>Open MT5 Web</LinkButton>
            {/* Escape hatch for expired/purged demo logins — mint a fresh one. */}
            <LinkButton href={METATRADER.mt5OpenDemo} icon={ExternalLink} subtle>Open demo</LinkButton>
            <LinkButton href={METATRADER.mt5Download} icon={ExternalLink} subtle>Get MT5 / MT4</LinkButton>
          </>
        ) : portal.webTradeUrl ? (
          <LinkButton href={portal.webTradeUrl} icon={ExternalLink}>Open Platform</LinkButton>
        ) : null}

        {canRefresh && (
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', pending && 'animate-spin')} strokeWidth={2} aria-hidden />
            {pending ? 'Syncing…' : 'Refresh sync'}
          </button>
        )}
      </div>

      {/* Quick actions into AlgoSphere's own surfaces for this account. */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-border/40 pt-3 text-[11px]">
        <QuickLink href="/execution" icon={Activity}>Positions</QuickLink>
        <QuickLink href="/journal" icon={BookOpen}>Journal trades</QuickLink>
        <QuickLink href="/analytics" icon={BarChart3}>Performance</QuickLink>
        <QuickLink href="/brokers" icon={Settings2}>Manage connection</QuickLink>
      </div>
    </div>
  )
}

function Metric({ label, value, sub, icon: Icon }: {
  label: string; value: string; sub?: boolean; icon?: LucideIcon
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />}{label}
      </div>
      <div className={cn('mt-0.5 font-semibold tabular-nums leading-none', sub ? 'text-[13px] text-foreground/85' : 'text-lg')}>
        {value}
      </div>
    </div>
  )
}

function LinkButton({ href, icon: Icon, children, primary, subtle }: {
  href: string; icon: LucideIcon; children: React.ReactNode; primary?: boolean; subtle?: boolean
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition',
        primary
          ? 'border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
          : subtle
          ? 'border border-border/60 text-muted-foreground hover:border-amber-500/40 hover:text-amber-300'
          : 'border border-border text-foreground/85 hover:border-amber-500/40 hover:text-amber-300',
      )}
    >
      {children}
      <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />
    </a>
  )
}

function QuickLink({ href, icon: Icon, children }: {
  href: string; icon: LucideIcon; children: React.ReactNode
}) {
  return (
    <a href={href} className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-amber-300">
      <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />{children}
    </a>
  )
}
