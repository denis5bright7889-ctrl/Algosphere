/**
 * /admin/communities — Telegram Community admin dashboard.
 *
 * Server component. Fetches every row via the service-role client so
 * archived items are also visible to admins. The actual CRUD happens
 * through /api/admin/communities and ./[id], driven by the client
 * component below.
 *
 * Refocus R3. Auth: ADMIN_EMAIL via lib/admin.
 */
import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import type { TelegramCommunity } from '@/lib/telegram-communities'
import CommunitiesManager from './CommunitiesManager'

export const metadata = { title: 'Communities Admin — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function AdminCommunitiesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!isAdmin(user.email)) redirect('/overview')

  const svc = createServiceClient()
  const { data, error } = await svc.from('telegram_communities')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Communities</h1>
        <div className="surface mt-4 border-rose-500/30 bg-rose-500/[0.04] p-4 text-xs text-rose-300">
          Failed to load communities: {error.message}
        </div>
      </div>
    )
  }

  const rows = (data ?? []) as TelegramCommunity[]

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Telegram <span className="text-gradient">Communities</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Admin-only. Adds and edits here propagate to the user-facing
            <a href="/communities" className="text-amber-300 hover:underline">&nbsp;/communities&nbsp;</a>
            browse instantly.
          </p>
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {rows.filter((r) => !r.archived_at).length} active · {rows.filter((r) => r.archived_at).length} archived
        </div>
      </header>

      <CommunitiesManager initial={rows} />
    </div>
  )
}
