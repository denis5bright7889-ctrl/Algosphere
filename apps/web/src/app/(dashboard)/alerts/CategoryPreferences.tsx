'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { CATEGORIES, type CategoryKey } from '@/lib/notifications/categories'
import { cn } from '@/lib/utils'

interface Props {
  /** routing_rules from `notification_preferences` — may be null. */
  initialRouting: Record<string, unknown> | null
}

/** Read `routing_rules[key].enabled` defensively — defaults to true. */
function isEnabled(routing: Record<string, unknown> | null, key: CategoryKey): boolean {
  const v = routing?.[key]
  if (v && typeof v === 'object' && 'enabled' in v) {
    return (v as { enabled: unknown }).enabled !== false
  }
  return true
}

export default function CategoryPreferences({ initialRouting }: Props) {
  const [routing, setRouting] = useState<Record<string, unknown> | null>(initialRouting)
  const [savingKey, setSavingKey] = useState<CategoryKey | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [, startTransition]       = useTransition()

  function toggle(key: CategoryKey) {
    const current = isEnabled(routing, key)
    const next    = !current
    const optimistic = { ...(routing ?? {}), [key]: { ...(routing?.[key] as object ?? {}), enabled: next } }
    setRouting(optimistic)
    setSavingKey(key)
    setError(null)

    startTransition(async () => {
      try {
        const res = await fetch('/api/alerts/preferences', {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ routing_rules: { [key]: { enabled: next } } }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error ?? 'Failed to save')
        // Server returns merged routing — adopt as source of truth.
        const merged = d.preferences?.routing_rules
        if (merged && typeof merged === 'object') setRouting(merged)
      } catch (e) {
        // Roll back optimistic change
        setRouting(routing)
        setError(e instanceof Error ? e.message : 'Failed to save')
      } finally {
        setSavingKey(null)
      }
    })
  }

  return (
    <ul className="space-y-3">
      {CATEGORIES.map((c) => {
        const enabled = isEnabled(routing, c.key)
        const Icon    = c.icon
        const saving  = savingKey === c.key
        return (
          <li key={c.key} className="flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
              <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{c.label}</p>
              <p className="text-[11px] text-muted-foreground">{c.hint}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={`${enabled ? 'Disable' : 'Enable'} ${c.label} notifications`}
              onClick={() => toggle(c.key)}
              disabled={saving}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                enabled ? 'bg-emerald-500/70' : 'bg-muted',
                saving && 'opacity-60',
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform',
                  enabled ? 'translate-x-5' : 'translate-x-0.5',
                )}
              />
              {saving && (
                <Loader2 className="absolute -right-5 h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
              )}
            </button>
          </li>
        )
      })}
      {error && <li className="text-[11px] text-rose-400">Couldn’t save: {error}</li>}
    </ul>
  )
}
