import BridgeClient from './BridgeClient'

export const metadata = { title: 'Bridge Health — Admin' }
// Real-time monitoring page; don't pre-render anything.
export const dynamic = 'force-dynamic'

/**
 * Server entry point for the MT5-bridge Command Center inside the
 * Vercel admin. Admin gate is enforced upstream by app/admin/layout.tsx
 * (isAdmin check + redirect on miss), so this page just renders the
 * client component which does the live polling against
 * /api/admin/bridge/* (proxied server-side, BRIDGE_API_KEY never
 * touches the browser).
 */
export default function AdminBridgePage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">
          MT5 Bridge <span className="text-gradient">Command Center</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Live state of the Windows VPS bridge. Polls every 3 seconds via the
          server-side proxy at <span className="font-mono">/api/admin/bridge/*</span> —
          the <span className="font-mono">BRIDGE_API_KEY</span> never reaches the
          browser. Same data as the standalone console at{' '}
          <a href="https://mt5.algospherequant.com/admin" target="_blank" rel="noreferrer"
             className="text-amber-300 hover:underline">
            mt5.algospherequant.com/admin
          </a>{' '}
          but unified inside the SaaS admin.
        </p>
      </header>
      <BridgeClient />
    </div>
  )
}
