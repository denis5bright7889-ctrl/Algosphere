import { createClient as serviceClient } from '@supabase/supabase-js'
import AdminPaymentCard from './AdminPaymentCard'

export const metadata = { title: 'Admin — Payments' }
export const dynamic = 'force-dynamic'

type StatusFilter = 'pending_review' | 'approved' | 'rejected' | 'all'

const TABS: { label: string; value: StatusFilter }[] = [
  { label: 'Pending Review', value: 'pending_review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'All', value: 'all' },
]

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: rawStatus } = await searchParams
  const status = (TABS.find((t) => t.value === rawStatus)?.value ?? 'pending_review') as StatusFilter

  const db = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const query = db
    .from('crypto_payments')
    .select(`
      id, plan, amount_usd, currency, network,
      wallet_address, txid, screenshot_url,
      status, admin_note, expires_at, created_at, reviewed_at,
      user_id,
      profiles:user_id ( full_name, subscription_tier )
    `)
    .order('created_at', { ascending: false })

  if (status !== 'all') query.eq('status', status)

  const { data: payments, error } = await query

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Payment Verifications</h1>
        <span className="text-sm text-muted-foreground">USDT TRC20 · Manual review</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {TABS.map((tab) => (
          <a
            key={tab.value}
            href={`/admin/payments?status=${tab.value}`}
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
          Error loading payments: {error.message}
        </div>
      )}

      {!payments?.length ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground text-sm">
          No {status === 'all' ? '' : status.replace('_', ' ')} payments.
        </div>
      ) : (
        <div className="space-y-4">
          {payments.map((p) => (
            <AdminPaymentCard key={p.id} payment={p as unknown as AdminPayment} />
          ))}
        </div>
      )}
    </div>
  )
}

export interface AdminPayment {
  id: string
  user_id: string
  plan: string
  amount_usd: number
  currency: string
  network: string
  wallet_address: string
  txid: string | null
  screenshot_url: string | null
  status: string
  admin_note: string | null
  expires_at: string
  created_at: string
  reviewed_at: string | null
  profiles: { full_name: string | null; subscription_tier: string } | null
}
