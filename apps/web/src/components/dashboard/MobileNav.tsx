'use client'

import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import Sidebar from './Sidebar'
import type { Tier } from './nav'
import Logo from '@/components/brand/Logo'

interface Props {
  tier?:    Tier
  isAdmin?: boolean
}

/**
 * Premium mobile drawer (per spec): 280px, matte glass, sticky
 * header with close button, role-filtered accordion nav. Slides in
 * from the left with a blurred backdrop.
 */
export default function MobileNav({ tier = 'free', isAdmin = false }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent touch-manipulation"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" strokeWidth={1.75} />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden animate-in fade-in duration-200"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col md:hidden glass-strong border-r border-border/70 animate-in slide-in-from-left duration-200">
            {/* Sticky header */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border/60 px-4 py-4 glass-strong">
              <a
                href="/overview"
                onClick={() => setOpen(false)}
                className="flex min-w-0 items-center gap-2"
              >
                <Logo size="sm" alt="" />
                <span className="truncate text-base font-bold tracking-tight">
                  <span className="text-gradient">AlgoSphere</span>{' '}
                  <span className="text-foreground/90">Quant</span>
                </span>
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground touch-manipulation"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto py-4">
              <Sidebar
                onNavigate={() => setOpen(false)}
                tier={tier}
                isAdmin={isAdmin}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}
