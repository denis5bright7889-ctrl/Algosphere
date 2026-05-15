'use client'

import { useState } from 'react'

export default function BillingPortalButton() {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const { url } = await res.json()
    window.location.href = url
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
    >
      {loading ? 'Loading…' : 'Manage billing'}
    </button>
  )
}
