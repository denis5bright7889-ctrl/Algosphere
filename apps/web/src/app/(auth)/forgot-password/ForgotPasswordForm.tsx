'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    setSent(true)
  }

  if (sent) {
    return (
      <div className="rounded-md bg-green-50 border border-green-200 px-4 py-5 text-center space-y-1">
        <p className="font-semibold text-green-800">Email sent</p>
        <p className="text-sm text-green-700">Check your inbox for the password reset link.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="you@example.com"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className={cn(
          'w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors',
          loading && 'opacity-50 cursor-not-allowed'
        )}
      >
        {loading ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  )
}
