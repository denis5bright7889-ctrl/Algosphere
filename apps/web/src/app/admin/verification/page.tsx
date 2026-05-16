import { createClient as serviceClient } from '@supabase/supabase-js'
import VerificationReviewCard from './VerificationReviewCard'

export const metadata = { title: 'Admin — Verifications' }
export const dynamic = 'force-dynamic'

type Filter = 'pending_verified' | 'verified' | 'rejected' | 'all'

const TABS: { label: string; value: Filter }[] = [
  { label: 'Pending Review', value: 'pending_verified' },
  { label: 'Verified',       value: 'verified' },
  { label: 'Rejected',       value: 'rejected' },
  { label: 'All',            value: 'all' },
]

export default async function AdminVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: raw } = await searchParams
  const status = (TABS.find(t => t.value === raw)?.value ?? 'pending_verified') as Filter

  const db = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  let query = db
    .from('trader_verifications')
    .select(`
      user_id, tier, application_status, broker_name, broker_statement_url,
      mt5_account_id, applied_at, verified_at, rejected_at, rejection_reason,
      live_trade_count, live_win_rate,
      profiles:user_id ( public_handle, bio ),
      trader_scores:user_id ( composite_score, win_rate, sharpe_ratio, total_trades, max_drawdown_pct )
    `)
    .order('applied_at', { ascending: false, nullsFirst: false })

  if (status === 'pending_verified') {
    query = query.eq('application_status', 'pending_verified')
  } else if (status === 'verified') {
    query = query.in('tier', ['verified', 'elite'])
  } else if (status === 'rejected') {
    query = query.eq('application_status', 'rejected')
  }

  const { data: rows, error } = await query

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Trader Verifications</h1>
        <span className="text-sm text-muted-foreground">Manual review · 3–5 day SLA</span>
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {TABS.map(tab => (
          <a
            key={tab.value}
            href={`/admin/verification?status=${tab.value}`}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              status === tab.value
                ? 'bg-background shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Error: {error.message}
        </div>
      )}

      {!rows?.length ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground text-sm">
          No {status === 'all' ? '' : status.replace('_', ' ')} applications.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map(r => (
            <VerificationReviewCard key={r.user_id} row={r as never} />
          ))}
        </div>
      )}
    </div>
  )
}
