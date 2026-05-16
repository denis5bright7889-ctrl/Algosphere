import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import JoinCommunityButton from '@/components/social/JoinCommunityButton'

export const metadata = { title: 'Premium Communities — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function CommunitiesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('premium_communities')
    .select(`*, profiles!premium_communities_owner_id_fkey ( public_handle )`)
    .eq('status', 'active')
    .order('member_count', { ascending: false })
    .limit(50)

  const communities = data ?? []

  const { data: myMemberships } = await supabase
    .from('community_memberships')
    .select('community_id')
    .eq('member_id', user.id)
    .eq('status', 'active')
  const joined = new Set((myMemberships ?? []).map(m => m.community_id))

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Premium <span className="text-gradient">Communities</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Paid Telegram groups — signals, mentorship, live breakdowns. Creators keep 80%.
          </p>
        </div>
      </header>

      {communities.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-14 text-center">
          <p className="text-sm text-muted-foreground">No communities yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {communities.map((c: any) => (
            <div
              key={c.id}
              className="rounded-2xl border border-border bg-card p-5 flex flex-col"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-bold text-base">{c.name}</h3>
              </div>
              {c.profiles?.public_handle && (
                <p className="text-[11px] text-muted-foreground">
                  by @{c.profiles.public_handle}
                </p>
              )}
              {c.description && (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
                  {c.description}
                </p>
              )}
              {c.perks?.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {c.perks.slice(0, 4).map((p: string) => (
                    <li key={p} className="text-[11px] text-muted-foreground flex gap-1.5">
                      <span className="text-amber-300">✓</span>{p}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto pt-4 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {c.member_count} members
                </span>
                <JoinCommunityButton
                  communityId={c.id}
                  priceMonthly={Number(c.price_monthly ?? 0)}
                  priceAnnual={c.price_annual ? Number(c.price_annual) : null}
                  isFree={!!c.is_free}
                  alreadyJoined={joined.has(c.id)}
                  isOwner={c.owner_id === user.id}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
