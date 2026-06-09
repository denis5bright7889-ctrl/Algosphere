/**
 * POST /api/admin/journal-backfill-closes — explicit backfill request.
 *
 * Per Phase 4 of the close-enrichment spec. In practice the
 * reconciler now runs the backfill on EVERY 30s cycle automatically
 * (see _backfill_unenriched_pair in broker_reconciler.py), so calling
 * this endpoint is purely a way to say "I want a status report on
 * what's pending" — there's no work to schedule that isn't already
 * scheduled.
 *
 * Returns the same shape as /api/admin/reconciliation-health so the
 * UI can use either. Admin-only.
 */
export { GET as POST, GET } from '../reconciliation-health/route'
