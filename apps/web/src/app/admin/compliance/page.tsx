import { createClient as serviceClient } from '@supabase/supabase-js'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Admin — Compliance & Audit' }
export const dynamic = 'force-dynamic'

const ACTION_TONE: Record<string, string> = {
  approve:   'text-emerald-300',
  reject:    'text-rose-300',
  create:    'text-amber-300',
  delete:    'text-rose-400',
  update:    'text-blue-300',
  publish:   'text-amber-300',
}

function toneFor(action: string): string {
  for (const [k, v] of Object.entries(ACTION_TONE)) if (action.includes(k)) return v
  return 'text-muted-foreground'
}

export default async function ComplianceAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; resource?: string }>
}) {
  const { q = '', resource = 'all' } = await searchParams

  const db = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  let query = db
    .from('audit_logs')
    .select('id, actor_id, actor_email, action, resource_type, resource_id, before_state, after_state, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (q.trim()) query = query.ilike('actor_email', `%${q.trim()}%`)
  if (resource !== 'all') query = query.eq('resource_type', resource)

  const { data: rows, error } = await query

  // Aggregate by resource type for filter chips
  const { data: resources } = await db
    .from('audit_logs')
    .select('resource_type')
    .limit(2000)
  const resourceCounts = new Map<string, number>()
  for (const r of resources ?? []) {
    if (r.resource_type) {
      resourceCounts.set(r.resource_type, (resourceCounts.get(r.resource_type) ?? 0) + 1)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Compliance & Audit Log</h1>
        <span className="text-xs text-muted-foreground">
          {rows?.length ?? 0} of last {Math.min(200, (rows?.length ?? 0))} events shown
        </span>
      </div>

      <form className="flex flex-wrap gap-2" action="/admin/compliance">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Filter by actor email…"
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
        />
        <button type="submit" className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted/30">
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-1">
        <a
          href="/admin/compliance"
          className={cn(
            'rounded-full border px-3 py-1 text-[11px] font-medium',
            resource === 'all'
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          All ({resources?.length ?? 0})
        </a>
        {Array.from(resourceCounts.entries()).map(([r, c]) => (
          <a
            key={r}
            href={`/admin/compliance?resource=${r}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-medium capitalize',
              resource === r
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {r.replace('_', ' ')} ({c})
          </a>
        ))}
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Error: {error.message}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Resource</th>
              <th className="px-4 py-3 font-medium">Resource ID</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map(r => (
              <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                <td className="px-4 py-2.5 text-[11px] text-muted-foreground tabular-nums">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-xs truncate max-w-[200px]">
                  {r.actor_email ?? r.actor_id?.slice(0, 8) ?? '—'}
                </td>
                <td className={cn('px-4 py-2.5 text-xs font-bold', toneFor(r.action))}>
                  {r.action}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">
                  {r.resource_type ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-[10px] font-mono text-muted-foreground">
                  {r.resource_id?.slice(0, 8) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!rows || rows.length === 0) && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No audit entries match these filters.
          </p>
        )}
      </div>
    </div>
  )
}
