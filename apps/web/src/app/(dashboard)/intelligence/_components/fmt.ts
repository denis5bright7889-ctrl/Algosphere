export function usd(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n), s = n < 0 ? '-' : ''
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`
  return `${s}$${a.toFixed(a < 1 ? 4 : 2)}`
}

export function pct(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—'
  const p = ratio * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`
}

export function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export const CHAIN_CLS: Record<string, string> = {
  ethereum: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  solana:   'border-violet-500/40 bg-violet-500/10 text-violet-300',
  base:     'border-sky-500/40 bg-sky-500/10 text-sky-300',
  arbitrum: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  polygon:  'border-purple-500/40 bg-purple-500/10 text-purple-300',
  bsc:      'border-amber-500/40 bg-amber-500/10 text-amber-300',
  optimism: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
}
