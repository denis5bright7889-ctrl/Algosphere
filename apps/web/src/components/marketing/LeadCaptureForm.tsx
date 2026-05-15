'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

export default function LeadCaptureForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-md bg-green-50 border border-green-200 px-4 py-4 text-sm text-green-800 font-medium">
        You&apos;re in! Check your inbox for your first signal.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
      <input
        type="email"
        required
        placeholder="your@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="flex-1 rounded-md border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        className={cn(
          'rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors',
          status === 'loading' && 'opacity-50 cursor-not-allowed'
        )}
      >
        {status === 'loading' ? 'Joining…' : 'Get free signal'}
      </button>
      {status === 'error' && (
        <p className="w-full text-xs text-destructive mt-1">Something went wrong — try again.</p>
      )}
    </form>
  )
}
