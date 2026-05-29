import { notFound } from 'next/navigation'

/**
 * Refocus R7: Execution Desk retired during the schema cleanup. The
 * page was built around copy_trades — that table goes away alongside
 * the deleted copy-engine (R2). Autotrade observability for direct
 * user execution will be rebuilt on top of PR #59B's arming model
 * when that branch lands. Until then the route 404s honestly.
 *
 * /algo remains the active autotrade onboarding surface.
 */
export const dynamic = 'force-dynamic'
export default function Page() { notFound() }
