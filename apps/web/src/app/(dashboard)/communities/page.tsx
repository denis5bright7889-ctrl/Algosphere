/**
 * /communities — Premium Telegram Community Hub (user-facing browse).
 *
 * Refocus R3: the only "community" surface in the refocused platform.
 * AlgoSphere is a directory, not a forum — each card links out to a
 * Telegram destination curated by admins.
 *
 * Server component. Reads the catalogue via the authenticated Supabase
 * client (RLS already filters archived rows). Tier-locked rows render
 * with a lock + upgrade CTA — they're not hidden, so users can see
 * what they could unlock.
 *
 * No posting. No threads. No follows. Click → Telegram.
 */
import { redirect } from 'next/navigation'
import {
  Crown, MessagesSquare, Megaphone, GraduationCap, Newspaper,
  Sparkles, Wrench, Users, ExternalLink, Lock, Pin, Star,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { effectiveTier } from '@/lib/admin'
import {
  type TelegramCommunity, type CommunityCategory, type CommunityKind,
  TIER_RANK,
} from '@/lib/telegram-communities'
import type { SubscriptionTier } from '@/lib/types'

export const metadata = { title: 'Telegram Communities — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const CATEGORY_META: Record<CommunityCategory, { label: string; icon: LucideIcon; tone: string }> = {
  vip:        { label: 'VIP',         icon: Crown,         tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  signals:    { label: 'Signals',     icon: Megaphone,     tone: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' },
  education:  { label: 'Education',   icon: GraduationCap, tone: 'text-blue-300 border-blue-500/40 bg-blue-500/10' },
  discussion: { label: 'Discussion',  icon: MessagesSquare,tone: 'text-foreground/85 border-border bg-card' },
  news:       { label: 'News',        icon: Newspaper,     tone: 'text-purple-300 border-purple-500/40 bg-purple-500/10' },
  tools:      { label: 'Tools',       icon: Wrench,        tone: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10' },
  other:      { label: 'Other',       icon: Sparkles,      tone: 'text-foreground/70 border-border bg-card' },
}

const KIND_LABEL: Record<CommunityKind, string> = {
  group:   'Group',
  channel: 'Channel',
  bot:     'Bot',
}

type Row = Omit<TelegramCommunity, 'archived_at'>

export default async function CommunitiesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, listRes] = await Promise.all([
    supabase.from('profiles')
      .select('subscription_tier, account_type')
      .eq('id', user.id)
      .single(),
    supabase.from('telegram_communities')
      .select(`
        id, slug, name, description, telegram_url, kind, category,
        visibility, is_featured, is_pinned, sort_order,
        icon_url, banner_url, member_count, created_at, updated_at
      `)
      .is('archived_at', null)
      .order('is_pinned', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const rows = (listRes.data ?? []) as Row[]
  const tier: SubscriptionTier = effectiveTier(
    user.email,
    (profile?.subscription_tier ?? 'free') as SubscriptionTier,
  )
  const userRank = TIER_RANK[tier] ?? 0

  // Group counts for the category strip; renders honest zeros.
  const byCategory: Record<CommunityCategory, number> = {
    vip: 0, signals: 0, education: 0,
    discussion: 0, news: 0, tools: 0, other: 0,
  }
  for (const r of rows) byCategory[r.category]++

  return (
    <div className="mx-auto max-w-5xl px-1 py-4 sm:px-4 sm:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Telegram <span className="text-gradient">Communities</span>
        </h1>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Admin-curated directory. Tap a card to open the conversation on
          Telegram. AlgoSphere doesn&apos;t host the discussion — these are
          pointers to the rooms where it&apos;s happening.
        </p>
      </header>

      {/* Category strip — honest counts, no fabricated chips */}
      <ul className="mb-5 flex flex-wrap gap-2">
        {(Object.keys(CATEGORY_META) as CommunityCategory[]).map((c) => {
          const m = CATEGORY_META[c]
          const n = byCategory[c]
          const Icon = m.icon
          return (
            <li
              key={c}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                n > 0 ? m.tone : 'border-border bg-card text-muted-foreground/70',
              )}
            >
              <Icon className="h-3 w-3" strokeWidth={1.75} />
              {m.label}
              <span className="tabular-nums opacity-70">·&nbsp;{n}</span>
            </li>
          )
        })}
      </ul>

      {rows.length === 0 ? (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          No communities are listed yet. Check back soon — admins are
          curating the first wave.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((c) => (
            <CommunityCard
              key={c.id}
              c={c}
              locked={(TIER_RANK[c.visibility] ?? 0) > userRank}
              userTier={tier}
            />
          ))}
        </ul>
      )}

      <p className="mt-6 text-center text-[10px] text-muted-foreground">
        AlgoSphere does not control the content of external Telegram
        rooms. Trade ideas shared there are not signals from the engine.
      </p>
    </div>
  )
}


function CommunityCard({ c, locked, userTier }: {
  c: Row
  locked: boolean
  userTier: SubscriptionTier
}) {
  const m = CATEGORY_META[c.category]
  const Icon = m.icon
  // Locked rows still render the Telegram URL — Telegram links aren't
  // secret — but the card swaps the CTA for an upgrade prompt to make
  // the gate visible to the user.
  return (
    <li className={cn(
      'surface p-4 flex gap-3',
      c.is_pinned && 'border-amber-500/40 bg-amber-500/[0.04]',
      locked && 'opacity-90',
    )}>
      <div className="shrink-0">
        {c.icon_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.icon_url}
            alt=""
            className="h-10 w-10 rounded-lg border border-border/60 object-cover"
          />
        ) : (
          <span className={cn(
            'inline-flex h-10 w-10 items-center justify-center rounded-lg border',
            m.tone,
          )}>
            <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {c.is_pinned && (
            <Pin className="h-3 w-3 text-amber-300" strokeWidth={2} aria-hidden />
          )}
          {c.is_featured && (
            <Star className="h-3 w-3 text-amber-300" strokeWidth={2} aria-hidden />
          )}
          <h3 className="text-sm font-semibold truncate">{c.name}</h3>
          <span className="rounded border border-border/60 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {KIND_LABEL[c.kind]}
          </span>
        </div>
        {c.description && (
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground line-clamp-3">
            {c.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className={cn(
            'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-semibold uppercase tracking-wider',
            m.tone,
          )}>
            <Icon className="h-2.5 w-2.5" strokeWidth={1.75} />
            {m.label}
          </span>
          {typeof c.member_count === 'number' && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="h-2.5 w-2.5" />
              {formatCount(c.member_count)}
            </span>
          )}
        </div>

        {locked ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              <Lock className="h-3 w-3" strokeWidth={2} />
              Requires {c.visibility}
            </span>
            <a
              href="/upgrade"
              className="text-[11px] font-semibold text-amber-300 hover:underline"
            >
              Upgrade from {userTier} →
            </a>
          </div>
        ) : (
          <a
            href={c.telegram_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-premium mt-3 inline-flex !px-3 !py-1.5 !text-[12px]"
          >
            Open on Telegram
            <ExternalLink className="h-3 w-3" strokeWidth={2.25} aria-hidden />
          </a>
        )}
      </div>
    </li>
  )
}

function formatCount(n: number): string {
  if (n >= 1000_000) return `${(n / 1000_000).toFixed(1)}M`
  if (n >= 1000)     return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
