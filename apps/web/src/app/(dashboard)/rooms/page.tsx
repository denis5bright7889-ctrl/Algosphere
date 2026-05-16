import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Trader Rooms — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

interface OfficialRoom {
  slug:          string
  name:          string
  platform:      string
  description:   string | null
  required_tier: string
  member_count:  number
  invite_url:    string | null
  has_access:    boolean
}

const PLATFORM_ICON: Record<string, string> = {
  telegram: '✈️',
  whatsapp: '💬',
  discord:  '🎮',
  slack:    '💼',
}

const TIER_CLS: Record<string, string> = {
  free:    'border-border bg-muted/30 text-muted-foreground',
  starter: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  premium: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  vip:     'border-amber-500/50 bg-amber-500/15 text-amber-300',
}

export default async function RoomsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', user.id)
    .single()
  const myTier = (profile?.subscription_tier ?? 'free') as string

  // Calls the SECURITY DEFINER RPC — invite_url is null for under-tier rooms
  const { data: rooms } = await supabase.rpc('my_official_communities')
  const list = (rooms ?? []) as OfficialRoom[]

  // Group by access
  const accessible = list.filter(r => r.has_access)
  const locked     = list.filter(r => !r.has_access)

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Trader <span className="text-gradient">Rooms</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Official AlgoSphere channels on Telegram, WhatsApp, Discord. VIP rooms
          unlock institutional flow + 1:1 mentorship windows.
        </p>
      </header>

      {accessible.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
            Your Rooms ({accessible.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {accessible.map(r => <RoomCard key={r.slug} room={r} unlocked />)}
          </div>
        </section>
      )}

      {locked.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
            Upgrade to unlock ({locked.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {locked.map(r => <RoomCard key={r.slug} room={r} currentTier={myTier} />)}
          </div>
        </section>
      )}

      {list.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No official rooms configured yet.
        </div>
      )}
    </div>
  )
}

function RoomCard({ room, unlocked, currentTier }: {
  room: OfficialRoom; unlocked?: boolean; currentTier?: string
}) {
  return (
    <div className={cn(
      'rounded-2xl border bg-card p-5 flex flex-col',
      unlocked ? 'border-border' : 'border-border opacity-60',
    )}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl flex-shrink-0">
          {PLATFORM_ICON[room.platform] ?? '💬'}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-base">{room.name}</h3>
          <p className="text-[11px] text-muted-foreground capitalize">
            {room.platform} · {room.member_count.toLocaleString()} members
          </p>
        </div>
        <span className={cn(
          'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
          TIER_CLS[room.required_tier] ?? TIER_CLS.free,
        )}>
          {room.required_tier === 'free' ? 'OPEN' : room.required_tier}
        </span>
      </div>

      {room.description && (
        <p className="text-xs text-muted-foreground mb-4 flex-1">{room.description}</p>
      )}

      {unlocked && room.invite_url ? (
        <a
          href={room.invite_url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-premium !text-xs !py-2 text-center"
        >
          {room.platform === 'whatsapp' ? 'Open WhatsApp →'
            : room.platform === 'discord'  ? 'Join Discord →'
            : room.platform === 'slack'    ? 'Open Slack →'
            : 'Join Telegram →'}
        </a>
      ) : (
        <div className="mt-auto">
          <a
            href="/dashboard/upgrade"
            className="block text-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 px-3 py-2 text-xs font-semibold hover:bg-amber-500 hover:text-black transition-colors"
          >
            🔒 Upgrade to {room.required_tier.toUpperCase()}{currentTier && currentTier !== 'free' ? ` (you have ${currentTier.toUpperCase()})` : ''}
          </a>
        </div>
      )}
    </div>
  )
}
