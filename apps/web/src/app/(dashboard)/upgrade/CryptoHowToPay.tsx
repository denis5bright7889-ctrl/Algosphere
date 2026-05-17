'use client'

import { useState } from 'react'
import {
  ChevronDown, ShieldAlert, CheckCircle2, Copy,
  Building2, Coins, Network, Wallet, Send, Hash, Hourglass,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Step {
  icon:    LucideIcon
  title:   string
  body:    string
  warning?: string
  /** Optional code/example snippet rendered as a copyable mono block. */
  example?: { value: string; copyable?: boolean }
}

const STEPS: Step[] = [
  {
    icon:  Building2,
    title: 'Create an exchange account',
    body:  'Open an account on Binance, Bybit, OKX or any major crypto exchange and complete KYC. If you already have one, skip ahead.',
  },
  {
    icon:  Coins,
    title: 'Buy USDT (Tether)',
    body:  'Buy or deposit USDT on the exchange spot market. The amount must match your plan exactly — Starter $29, Pro $99, VIP $299.',
  },
  {
    icon:  Network,
    title: 'Select the TRC20 network',
    body:  'When withdrawing, choose TRC20 (Tron). Lowest fees, ~5-15 min confirmations.',
    warning: 'Never send on ERC-20 (Ethereum) or BEP-20 (BSC) — funds sent on the wrong network are unrecoverable.',
  },
  {
    icon:  Wallet,
    title: 'Copy your unique deposit address',
    body:  'After picking a plan below, you’ll get a fresh address and the exact USDT amount. Each payment uses a new address — never reuse an old one.',
  },
  {
    icon:  Send,
    title: 'Send the payment',
    body:  'Paste the address in your exchange’s Withdraw form, enter the exact amount, confirm with 2FA, and submit.',
    warning: 'Send the exact amount in one transaction. Partial / multiple sends slow down verification.',
  },
  {
    icon:  Hash,
    title: 'Paste your TXID',
    body:  'Your exchange returns a Transaction ID (TXID / hash) once submitted. Copy it into the verification form on the payment page.',
    example: { value: 'e.g. 7e8f1a3c5b2d…  (64-char hex on Tron)', copyable: false },
  },
  {
    icon:  Hourglass,
    title: 'Wait for confirmation',
    body:  'Confirmations take ~5–15 minutes on TRC20. As soon as the network confirms and the transfer is matched to your TXID, your plan auto-activates and you’ll get a push + email notification.',
  },
]

export default function CryptoHowToPay() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)

  function copy(i: number, value: string) {
    navigator.clipboard?.writeText(value).then(
      () => { setCopied(i); setTimeout(() => setCopied(null), 1400) },
      () => {},
    )
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/70 glass">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary" aria-hidden />

      {/* Header — toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // jsx-a11y/aria-proptypes false-positive on dynamic boolean; runtime is clean.
        // eslint-disable-next-line jsx-a11y/aria-proptypes
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-3">
          <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
            <Wallet className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
          </span>
          <span>
            <h3 className="text-sm font-bold tracking-tight">How to pay with crypto</h3>
            <p className="text-xs text-muted-foreground">7 quick steps · USDT on TRC20</p>
          </span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform duration-300', open && 'rotate-180')}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      {/* Animated collapsible (grid-template-rows trick) */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border/60 px-5 py-5">
            {/* Visual stepper */}
            <ol className="mb-5 flex items-center gap-1.5 overflow-x-auto pb-1" aria-hidden>
              {STEPS.map((_, i) => (
                <li key={i} className="flex flex-1 items-center gap-1.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-amber-500/40 bg-amber-500/10 text-[10px] font-bold text-amber-300">
                    {i + 1}
                  </span>
                  {i < STEPS.length - 1 && (
                    <span className="h-px flex-1 bg-border/70" />
                  )}
                </li>
              ))}
            </ol>

            {/* Step cards */}
            <ol className="space-y-3">
              {STEPS.map((s, i) => {
                const Icon = s.icon
                return (
                  <li
                    key={i}
                    className="relative rounded-xl border border-border/60 bg-card/40 p-4 transition-colors hover:border-amber-500/30"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300">
                        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2 text-sm font-semibold">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300/80">
                            Step {i + 1}
                          </span>
                          {s.title}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>

                        {s.example && (
                          <div className="mt-2 flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs">
                            <span className="flex-1 truncate font-mono text-muted-foreground">
                              {s.example.value}
                            </span>
                            {s.example.copyable && (
                              <button
                                type="button"
                                onClick={() => copy(i, s.example!.value)}
                                aria-label="Copy"
                                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                              >
                                {copied === i
                                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2} />
                                  : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
                              </button>
                            )}
                          </div>
                        )}

                        {s.warning && (
                          <p className="mt-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                            <ShieldAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                            <span>{s.warning}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>

            <p className="mt-5 text-center text-xs text-muted-foreground">
              Stuck? Email <a href="mailto:support@algospherequant.com" className="text-amber-300 hover:underline">support@algospherequant.com</a> with your TXID and plan.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
