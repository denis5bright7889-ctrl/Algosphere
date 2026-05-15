'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  userId: string
  initialName: string
}

export default function AccountForm({ initialName }: Props) {
  const [name, setName] = useState(initialName)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: name }),
    })
    setStatus(res.ok ? 'saved' : 'error')
    if (res.ok) setTimeout(() => setStatus('idle'), 2000)
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="flex-1 space-y-1">
        <label htmlFor="full-name" className="text-xs font-medium text-muted-foreground">
          Full name
        </label>
        <input
          id="full-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Jane Doe"
        />
      </div>
      <button
        type="submit"
        disabled={status === 'saving'}
        className={cn(
          'rounded-md px-4 py-2 text-sm font-medium transition-colors',
          status === 'saved'
            ? 'bg-green-600 text-white'
            : 'bg-primary text-primary-foreground hover:bg-primary/90',
          status === 'saving' && 'opacity-50 cursor-not-allowed'
        )}
      >
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save'}
      </button>
      {status === 'error' && (
        <p className="text-xs text-destructive">Failed to save.</p>
      )}
    </form>
  )
}
