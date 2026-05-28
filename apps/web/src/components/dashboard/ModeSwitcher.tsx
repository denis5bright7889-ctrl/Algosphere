'use client'

/**
 * ModeSwitcher — the global mode control (LAYER 1 of the terminal IA).
 *
 * Four segments: Trade · Analyze · Research · Community. The active mode
 * is derived from the URL (`modeForPath`) so deep links and back/forward
 * always reflect the right context. Clicking a mode routes to that mode's
 * home — which re-renders the rail + workspace for that intent. One mode,
 * one intent; no mixing.
 *
 * Desktop: full segmented control with labels. Tablet: icons only. The
 * mobile bottom nav carries the same four modes (separate component).
 */
import { useRouter, usePathname } from 'next/navigation'
import { MODES, modeForPath } from '@/lib/modes'
import { cn } from '@/lib/utils'

export default function ModeSwitcher() {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const active = modeForPath(pathname)

  return (
    <div
      role="tablist"
      aria-label="Terminal mode"
      className="inline-flex items-center gap-0.5 rounded-xl border border-border/70 bg-card/40 p-0.5"
    >
      {MODES.map((m) => {
        const Icon = m.icon
        const isActive = m.id === active
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={m.blurb}
            onClick={() => { if (!isActive) router.push(m.home) }}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all',
              isActive
                ? 'bg-gradient-primary text-black shadow-glow-gold'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={isActive ? 2.2 : 1.75} aria-hidden />
            <span className="hidden lg:inline">{m.label}</span>
          </button>
        )
      })}
    </div>
  )
}
