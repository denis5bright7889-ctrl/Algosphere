'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  userId: string
  currentChatId: number | null
}

export default function TelegramLinkForm({ currentChatId }: Props) {
  const [chatId, setChatId] = useState(currentChatId ? String(currentChatId) : '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_chat_id: chatId ? parseInt(chatId) : null }),
    })
    setStatus(res.ok ? 'saved' : 'error')
    if (res.ok) setTimeout(() => setStatus('idle'), 2000)
  }

  const isLinked = !!currentChatId

  return (
    <div className="space-y-3">
      {isLinked && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
          <span>✓</span>
          <span>Linked to Telegram ID <strong>{currentChatId}</strong></span>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div className="flex-1 space-y-1">
          <label htmlFor="chat-id" className="text-xs font-medium text-muted-foreground">
            Telegram Chat ID
          </label>
          <input
            id="chat-id"
            type="number"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="123456789"
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
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : isLinked ? 'Update' : 'Link'}
        </button>
      </form>
      {status === 'error' && <p className="text-xs text-destructive">Failed to save. Try again.</p>}
    </div>
  )
}
