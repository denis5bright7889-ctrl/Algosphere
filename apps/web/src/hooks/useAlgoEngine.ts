'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export interface RegimeUpdate {
  type: 'regime'
  symbol: string
  regime: string
  score: number
  timestamp: number
}

export interface SignalUpdate {
  type: 'signal'
  symbol: string
  signal_id: string
  tier_required: string
  timestamp: number
}

type AlgoMessage = RegimeUpdate | SignalUpdate | { type: 'ping' } | { type: 'analytics' }

interface UseAlgoEngineOptions {
  channel: 'signals' | 'regime' | 'analytics'
  tier?: string
  symbols?: string[]
  onMessage?: (msg: AlgoMessage) => void
  enabled?: boolean
}

const ENGINE_URL = process.env.NEXT_PUBLIC_SIGNAL_ENGINE_WS_URL

export function useAlgoEngine({
  channel,
  tier = 'free',
  symbols = [],
  onMessage,
  enabled = true,
}: UseAlgoEngineOptions) {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!ENGINE_URL || !enabled || !mountedRef.current) return

    const url = `${ENGINE_URL}/ws/${channel}?tier=${tier}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      setConnected(true)
      // Subscribe to specific symbols if provided
      if (symbols.length > 0) {
        ws.send(JSON.stringify({ type: 'subscribe', symbols }))
      }
    }

    ws.onmessage = (event) => {
      if (!mountedRef.current) return
      try {
        const msg: AlgoMessage = JSON.parse(event.data)
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
          return
        }
        onMessage?.(msg)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setConnected(false)
      // Reconnect with backoff
      reconnectTimer.current = setTimeout(connect, 5000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [channel, tier, symbols, onMessage, enabled])

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { connected, engineConfigured: Boolean(ENGINE_URL) }
}
