import { notFound } from 'next/navigation'

/**
 * Refocus R7: route retired during the schema cleanup. Its data
 * sources (copy_jobs / copy_jobs_dlq / copy_reconciliation /
 * copy_health) are dropped alongside the retired copy-engine. The
 * autotrade observability surface from PR #59B (held) will fill any
 * legitimate gap once that branch lands.
 */
export const dynamic = 'force-dynamic'
export default function Page() { notFound() }
