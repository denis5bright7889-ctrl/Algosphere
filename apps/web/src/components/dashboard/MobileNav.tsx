'use client'

import { useState } from 'react'
import Sidebar from './Sidebar'
import Logo from '@/components/brand/Logo'

export default function MobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden p-2 rounded-md hover:bg-accent"
        aria-label="Open menu"
      >
        <span className="block w-5 h-0.5 bg-foreground mb-1" />
        <span className="block w-5 h-0.5 bg-foreground mb-1" />
        <span className="block w-5 h-0.5 bg-foreground" />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setOpen(false)}
          />
          {/* Drawer */}
          <div className="fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border flex flex-col py-6 md:hidden">
            <div className="px-4 mb-6 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <Logo size="sm" alt="" />
                <span className="font-bold text-base tracking-tight truncate">
                  <span className="text-gradient">AlgoSphere</span> Quant
                </span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-md hover:bg-accent text-muted-foreground"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}
    </>
  )
}
