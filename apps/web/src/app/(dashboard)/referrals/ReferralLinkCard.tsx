'use client'

import { useEffect, useState } from 'react'
import { referralLink } from '@/lib/referrals'
import { cn } from '@/lib/utils'

interface Props {
  code: string
  commissionPct: number
}

export default function ReferralLinkCard({ code, commissionPct }: Props) {
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)

  // Build from the live origin so it works on any deployment domain
  useEffect(() => {
    setLink(referralLink(window.location.origin, code))
  }, [code])

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — user can still select manually */
    }
  }

  function share() {
    if (navigator.share) {
      navigator.share({
        title: 'AlgoSphere Quant',
        text: 'Institutional-grade AI trading signals. Join with my link:',
        url: link,
      }).catch(() => {})
    } else {
      copy()
    }
  }

  return (
    <div className="card-premium p-5 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-gold" aria-hidden />
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold tracking-tight">Your referral link</h2>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-300">
          {commissionPct}% commission
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-background px-3 py-2.5 text-xs font-mono text-foreground/90">
          {link || `…/signup?ref=${code}`}
        </code>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className={cn(
              'min-h-[42px] shrink-0 rounded-lg px-4 text-sm font-semibold touch-manipulation transition-all',
              copied ? 'bg-emerald-600 text-white' : 'btn-premium',
            )}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={share}
            className="min-h-[42px] shrink-0 btn-glass px-4 text-sm"
          >
            Share
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Earn <strong className="text-amber-300">{commissionPct}%</strong> of the first
        payment from everyone who subscribes through your link. Commission accrues
        automatically when their payment is approved.
      </p>
    </div>
  )
}
