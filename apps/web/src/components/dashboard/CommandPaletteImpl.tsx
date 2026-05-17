'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft } from 'lucide-react'
import { NAV_FLAT } from './nav'
import { cn } from '@/lib/utils'

/**
 * Heavy panel for the ⌘K palette. Mounted lazily via next/dynamic
 * from the eager <CommandPalette /> wrapper on first activation, so
 * the nav-registry + lucide icons used here don't ship in the
 * initial dashboard bundle.
 *
 * Receives open + onClose from the wrapper so close + ESC behaviour
 * lives in one place. Internal input/result state stays here.
 */
interface Props {
  open:    boolean
  onClose: () => void
}

export default function CommandPaletteImpl({ open, onClose }: Props) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Re-focus + reset on each open
  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return NAV_FLAT
    return NAV_FLAT.filter((i) =>
      (i.label + ' ' + (i.keywords ?? '') + ' ' + i.href)
        .toLowerCase()
        .includes(term),
    )
  }, [q])

  useEffect(() => { setActive(0) }, [q])

  function go(href: string) {
    onClose()
    router.push(href)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh] bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/70 glass-strong shadow-glow animate-in slide-in-from-top-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border/60 px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
              if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
              if (e.key === 'Enter' && results[active]) go(results[active].href)
            }}
            placeholder="Jump to…  (try “brokers”, “risk”, “academy”)"
            aria-label="Search navigation"
            className="w-full bg-transparent py-4 text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <kbd className="hidden sm:block rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>

        <ul className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</li>
          )}
          {results.map((item, i) => {
            const Icon = item.icon
            return (
              <li key={item.href}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item.href)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    i === active
                      ? 'bg-gradient-primary text-white shadow-glow'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="flex-1 text-left">{item.label}</span>
                  <span className="font-mono text-[11px] opacity-60">{item.href}</span>
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 opacity-80" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
