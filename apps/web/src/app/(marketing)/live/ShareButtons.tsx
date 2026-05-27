'use client'

/**
 * Public share-this-page row for /live. One-tap to X / Telegram / Reddit /
 * copy-link. Each share carries a UTM tag so growth attribution is visible.
 */
import { useState } from 'react'

const SHARE_URL = 'https://algospherequant.com/live'
const SHARE_TEXT =
  'AlgoSphere Quant — live institutional signals (forex, metals, indices, crypto). Regime-aware, risk-gated, free to watch.'

function utm(channel: string): string {
  return `${SHARE_URL}?utm_source=${channel}&utm_medium=share&utm_campaign=live`
}

export default function ShareButtons() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(utm('link'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {/* ignore */}
  }

  const tw =
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(utm('x'))}`
  const tg =
    `https://t.me/share/url?url=${encodeURIComponent(utm('telegram'))}&text=${encodeURIComponent(SHARE_TEXT)}`
  const rd =
    `https://www.reddit.com/submit?title=${encodeURIComponent('AlgoSphere Quant — live institutional signals')}&url=${encodeURIComponent(utm('reddit'))}`

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Share this page</span>
      <a href={tw} target="_blank" rel="noopener noreferrer"
         className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold hover:border-amber-500/40">
        Post to X
      </a>
      <a href={tg} target="_blank" rel="noopener noreferrer"
         className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold hover:border-amber-500/40">
        Telegram
      </a>
      <a href={rd} target="_blank" rel="noopener noreferrer"
         className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold hover:border-amber-500/40">
        Reddit
      </a>
      <button type="button" onClick={copy}
              className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold hover:border-amber-500/40">
        {copied ? 'Copied ✓' : 'Copy link'}
      </button>
    </div>
  )
}
