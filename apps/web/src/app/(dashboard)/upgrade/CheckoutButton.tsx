'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  planId: 'starter' | 'premium'
}

export default function CheckoutButton({ planId }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      })
      const { url, error } = await res.json()
      if (error) throw new Error(error)
      window.location.href = url
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={cn(
        'block w-full rounded-md bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors',
        loading && 'opacity-50 cursor-not-allowed'
      )}
    >
      {loading ? 'Redirecting…' : 'Start 7-day trial'}
    </button>
  )
}
