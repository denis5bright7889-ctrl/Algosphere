'use client'

import { useState } from 'react'
import type { JournalEntry } from '@/lib/types'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import AddTradeModal from './AddTradeModal'

interface Props {
  initialEntries: JournalEntry[]
  userId: string
}

export default function JournalClient({ initialEntries, userId }: Props) {
  const [entries, setEntries] = useState<JournalEntry[]>(initialEntries)
  const [showModal, setShowModal] = useState(false)

  const totalPnl = entries.reduce((s, e) => s + (e.pnl ?? 0), 0)
  const wins = entries.filter((e) => (e.pnl ?? 0) > 0).length
  const losses = entries.filter((e) => (e.pnl ?? 0) < 0).length
  const winRate = entries.length ? Math.round((wins / entries.length) * 100) : 0

  function handleAdded(entry: JournalEntry) {
    setEntries((prev) => [entry, ...prev])
    setShowModal(false)
  }

  async function handleDelete(id: string) {
    // Mobile-safety: never delete on a stray tap
    if (typeof window !== 'undefined' && !window.confirm('Delete this trade?')) return
    const res = await fetch(`/api/journal/${id}`, { method: 'DELETE' })
    if (res.ok) setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Trade Journal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {entries.length} trade{entries.length !== 1 ? 's' : ''} logged
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="min-h-[44px] rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 touch-manipulation"
        >
          + Add trade
        </button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total P&L', value: formatCurrency(totalPnl), color: totalPnl >= 0 ? 'text-green-600' : 'text-red-600' },
          { label: 'Win Rate', value: `${winRate}%`, color: '' },
          { label: 'Wins', value: String(wins), color: 'text-green-600' },
          { label: 'Losses', value: String(losses), color: 'text-red-600' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn('mt-1 text-xl font-bold', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table (desktop) / card list (mobile) */}
      {entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">No trades yet. Log your first trade!</p>
        </div>
      ) : (
        <>
        {/* Mobile card view */}
        <ul className="space-y-3 md:hidden">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold truncate">{e.pair ?? '—'}</span>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                      e.direction === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    )}>
                      {e.direction ?? '—'}
                    </span>
                    {e.setup_tag && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize">
                        {e.setup_tag}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {e.trade_date ? formatDate(e.trade_date) : '—'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Delete trade"
                  onClick={() => handleDelete(e.id)}
                  className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive active:bg-accent touch-manipulation"
                >
                  ✕
                </button>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <p className="text-muted-foreground">Entry</p>
                  <p className="font-medium tabular-nums">{e.entry_price ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Exit</p>
                  <p className="font-medium tabular-nums">{e.exit_price ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Lots</p>
                  <p className="font-medium tabular-nums">{e.lot_size ?? '—'}</p>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                <div className="text-[11px]">
                  <span className="text-muted-foreground">Pips:</span>{' '}
                  {e.pips != null ? (
                    <span className={cn('font-semibold tabular-nums', e.pips >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {e.pips >= 0 ? '+' : ''}{e.pips}
                    </span>
                  ) : '—'}
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {e.pnl != null ? (
                    <span className={e.pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {formatCurrency(e.pnl)}
                    </span>
                  ) : '—'}
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* Desktop table view */}
        <div className="hidden md:block rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                {['Date', 'Pair', 'Dir', 'Entry', 'Exit', 'Lots', 'Pips', 'P&L', 'Setup', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {e.trade_date ? formatDate(e.trade_date) : '—'}
                  </td>
                  <td className="px-4 py-3 font-medium">{e.pair ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-semibold uppercase',
                      e.direction === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    )}>
                      {e.direction ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{e.entry_price ?? '—'}</td>
                  <td className="px-4 py-3">{e.exit_price ?? '—'}</td>
                  <td className="px-4 py-3">{e.lot_size ?? '—'}</td>
                  <td className="px-4 py-3">
                    {e.pips != null ? (
                      <span className={e.pips >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {e.pips >= 0 ? '+' : ''}{e.pips}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {e.pnl != null ? (
                      <span className={e.pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {formatCurrency(e.pnl)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {e.setup_tag ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
                        {e.setup_tag}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      aria-label="Delete trade"
                      onClick={() => handleDelete(e.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-destructive touch-manipulation"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {showModal && (
        <AddTradeModal
          userId={userId}
          onAdded={handleAdded}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
