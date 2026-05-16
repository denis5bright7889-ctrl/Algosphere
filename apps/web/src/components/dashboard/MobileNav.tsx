'use client'

import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import Sidebar from './Sidebar'
import Logo from '@/components/brand/Logo'

export default function MobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden rounded-md p-2 text-foreground transition-colors hover:bg-accent"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" strokeWidth={1.75} />
      </button>

      {open && (
        <>
          {/* Blurred overlay backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden animate-in fade-in duration-200"
            onClick={() => setOpen(false)}
          />
          {/* Drawer */}
          <div className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col py-6 md:hidden glass-strong border-r border-border/70 animate-in slide-in-from-left duration-200">
            <div className="mb-6 flex items-center justify-between gap-2 px-4">
              <span className="flex min-w-0 items-center gap-2">
                <Logo size="sm" alt="" />
                <span className="truncate text-base font-bold tracking-tight">
                  <span className="text-gradient">AlgoSphere</span>{' '}
                  <span className="text-foreground/90">Quant</span>
                </span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <Sidebar onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </>
      )}
    </>
  )
}
