'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface User {
  id: string
  full_name: string | null
  subscription_tier: string
  subscription_status: string | null
  telegram_chat_id: number | null
  created_at: string
}

const TIER_STYLE: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  starter: 'bg-blue-100 text-blue-700',
  premium: 'bg-yellow-100 text-yellow-700',
}

export default function UserTable() {
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState('all')
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), tier })
    if (search) params.set('search', search)
    const res = await window.fetch(`/api/admin/users?${params}`)
    if (res.ok) {
      const json = await res.json()
      setUsers(json.data ?? [])
      setTotal(json.total ?? 0)
    }
    setLoading(false)
  }, [page, tier, search])

  useEffect(() => { fetch() }, [fetch])

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Search by name…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={tier}
          onChange={e => { setTier(e.target.value); setPage(1) }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All tiers</option>
          <option value="free">Free</option>
          <option value="starter">Starter</option>
          <option value="premium">Premium</option>
        </select>
        <button
          type="button"
          onClick={fetch}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Search
        </button>
      </div>

      <p className="text-xs text-muted-foreground">{total} users found</p>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground text-left">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Telegram</th>
              <th className="px-4 py-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No users found.</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-4 py-3">
                  <p className="font-medium">{u.full_name ?? '—'}</p>
                  <p className="text-xs text-muted-foreground font-mono">{u.id.slice(0, 8)}…</p>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold capitalize', TIER_STYLE[u.subscription_tier] ?? '')}>
                    {u.subscription_tier}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                  {u.subscription_status ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs">
                  {u.telegram_chat_id ? (
                    <span className="text-green-600 font-medium">✓ Linked</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {formatDate(u.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
