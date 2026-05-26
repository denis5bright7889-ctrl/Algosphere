'use client'

import { useEffect } from 'react'

/**
 * Last-resort boundary. Catches failures in the root layout itself
 * (where segment-level error.tsx cannot reach). Must render its own
 * <html>/<body>. Kept dependency-free and inline-styled so it works
 * even if the app shell / CSS pipeline is what failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global] fatal error:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0b',
          color: '#e7e7ea',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
            AlgoSphere is temporarily unavailable
          </h1>
          <p style={{ fontSize: 14, color: '#9a9aa2', margin: '0 0 20px' }}>
            We hit an unexpected error. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: '1px solid rgba(245,158,11,0.4)',
              background: 'rgba(245,158,11,0.12)',
              color: '#fbbf24',
              fontSize: 14,
              fontWeight: 600,
              padding: '8px 18px',
              borderRadius: 12,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ fontSize: 10, color: '#55555c', marginTop: 24, fontFamily: 'monospace' }}>
              ref: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
