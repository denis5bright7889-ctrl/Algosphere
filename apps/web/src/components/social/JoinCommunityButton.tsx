'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  communityId:    string
  priceMonthly:   number
  priceAnnual:    number | null
  isFree:         boolean
  alreadyJoined:  boolean
  isOwner:        boolean
}

export default function JoinCommunityButton({
  communityId, priceMonthly, priceAnnual, isFree, alreadyJoined, isOwner,
}: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  if (isOwner) {
    return (
      <span className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">
        Your community
      </span>
    )
  }
  if (alreadyJoined) {
    return (
      <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
        ✓ Member
      </span>
    )
  }

  async function join(plan: 'free' | 'monthly' | 'annual') {
    setError(null)
    setPicking(false)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/communities/${communityId}/join`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ plan }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed')
        if (data.requires_payment) {
          window.location.href = data.payment_url
          return
        }
        setInvite(data.telegram_invite ?? null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  if (invite) {
    return (
      <a
        href={invite}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300"
      >
        ✓ Joined — Open Telegram →
      </a>
    )
  }

  if (isFree) {
    return (
      <>
        <button
          type="button"
          onClick={() => join('free')}
          disabled={pending}
          className={cn(
            'rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 px-3 py-1.5 text-xs font-semibold hover:bg-amber-500 hover:text-black transition-colors',
            pending && 'opacity-60 cursor-wait',
          )}
        >
          {pending ? 'Joining…' : 'Join Free'}
        </button>
        {error && <p className="text-[10px] text-rose-400 mt-1">{error}</p>}
      </>
    )
  }

  if (picking) {
    return (
      <div className="flex flex-col gap-1.5 items-stretch">
        <button
          type="button"
          onClick={() => join('monthly')}
          disabled={pending}
          className="btn-premium !text-[11px] !py-1.5 !px-3"
        >
          Monthly · ${priceMonthly}
        </button>
        {priceAnnual && (
          <button
            type="button"
            onClick={() => join('annual')}
            disabled={pending}
            className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-[11px] font-semibold text-amber-300"
          >
            Annual · ${priceAnnual}
          </button>
        )}
        {error && <p className="text-[10px] text-rose-400">{error}</p>}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setPicking(true)}
      className="rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 px-3 py-1.5 text-xs font-semibold hover:bg-amber-500 hover:text-black transition-colors"
    >
      Join · ${priceMonthly}/mo
    </button>
  )
}
