'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Signal } from '@/lib/types'

export function useRealtimeSignals(initial: Signal[]) {
  const [signals, setSignals] = useState<Signal[]>(initial)
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('public:signals')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'signals' },
        (payload) => {
          const newSignal = payload.new as Signal
          setSignals(prev => [newSignal, ...prev])
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'signals' },
        (payload) => {
          const updated = payload.new as Signal
          setSignals(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s))
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'signals' },
        (payload) => {
          const deleted = payload.old as { id: string }
          setSignals(prev => prev.filter(s => s.id !== deleted.id))
        }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return { signals, connected }
}
