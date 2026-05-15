'use client'

import { useState } from 'react'
import {
  PLAN_PRICES_USD, priceFor, annualPrice, annualSavings,
  ANNUAL_DISCOUNT_PCT, type BillingInterval,
} from '@/lib/payments/binance'
import { cn } from '@/lib/utils'
import PaymentProofForm from './PaymentProofForm'
import PaymentStatusDisplay from './PaymentStatusDisplay'

type FlowStep = 'select' | 'instructions' | 'submit' | 'status'

interface PaymentSession {
  payment_id: string
  wallet_address: string
  amount_usd: number
  currency: string
  network: string
  plan: string
  expires_at: string
}

type PlanId = 'starter' | 'premium' | 'vip'

interface Props {
  currentTier: string
}

const PLANS = [
  {
    id: 'starter' as const,
    name: 'Starter',
    price: PLAN_PRICES_USD.starter,
    features: ['Daily AI signals', 'Forex + Commodities', 'Risk dashboard', 'Telegram alerts'],
    highlight: false,
    badge: null,
  },
  {
    id: 'premium' as const,
    name: 'Pro',
    price: PLAN_PRICES_USD.premium,
    features: ['Everything in Starter', 'Crypto signals', 'WhatsApp alerts', 'Priority support'],
    highlight: true,
    badge: 'Most popular',
  },
  {
    id: 'vip' as const,
    name: 'VIP',
    price: PLAN_PRICES_USD.vip,
    features: ['Everything in Pro', 'Copy-trading (MT5, cTrader)', 'Private Telegram group', 'API access'],
    highlight: false,
    badge: 'Institutional',
  },
]

export default function CryptoPaymentFlow({ currentTier }: Props) {
  const [step, setStep] = useState<FlowStep>('select')
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null)
  const [interval, setBillingInterval] = useState<BillingInterval>('monthly')
  const [session, setSession] = useState<PaymentSession | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSelectPlan(plan: PlanId) {
    setSelectedPlan(plan)
    setError(null)
    setCreating(true)
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409 && data.payment_id) {
          // Existing pending payment
          setSession({ ...data, plan, amount_usd: priceFor(plan, interval) })
          setStep('status')
          return
        }
        throw new Error(data.error ?? 'Failed to create payment')
      }
      setSession(data)
      setStep('instructions')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setCreating(false)
    }
  }

  function handleProofSubmitted() {
    setStep('status')
  }

  if (step === 'status' && session) {
    return <PaymentStatusDisplay paymentId={session.payment_id} plan={session.plan} />
  }

  if (step === 'submit' && session) {
    return (
      <PaymentProofForm
        session={session}
        onSubmitted={handleProofSubmitted}
        onBack={() => setStep('instructions')}
      />
    )
  }

  if (step === 'instructions' && session) {
    return <PaymentInstructions session={session} onContinue={() => setStep('submit')} />
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {/* Billing-interval toggle */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1">
          {(['monthly', 'annual'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setBillingInterval(opt)}
              className={cn(
                'rounded-full px-4 py-1.5 text-xs font-semibold transition-all touch-manipulation',
                interval === opt
                  ? 'bg-gradient-gold text-black shadow-glow-gold'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt === 'monthly' ? 'Monthly' : `Annual · save ${ANNUAL_DISCOUNT_PCT}%`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentTier
          const isVip = plan.id === 'vip'
          return (
            <div
              key={plan.id}
              className={cn(
                'relative rounded-2xl border p-6 flex flex-col transition-all duration-300',
                plan.highlight && 'border-amber-500/40 bg-card shadow-glow-gold lg:scale-[1.02]',
                isVip && 'border-amber-500/30 bg-gradient-to-b from-amber-500/[0.06] to-card hover:border-amber-500/50 hover:shadow-glow',
                !plan.highlight && !isVip && 'border-border bg-card hover:border-amber-500/30 hover:shadow-card-lift',
              )}
            >
              {plan.highlight && (
                <>
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-gold rounded-t-2xl" aria-hidden />
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-gold px-3 py-1 text-[10px] font-bold tracking-widest text-black uppercase shadow-glow-gold">
                    {plan.badge}
                  </span>
                </>
              )}
              {isVip && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-amber-500/40 bg-background px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase">
                  {plan.badge}
                </span>
              )}

              <h3 className={cn('text-lg font-bold tracking-tight', (plan.highlight || isVip) && 'text-gradient')}>
                {plan.name}
              </h3>
              <div className="mt-1 mb-1 flex items-end gap-1">
                <span className={cn('text-3xl font-extrabold tabular-nums', (plan.highlight || isVip) && 'text-gradient')}>
                  ${interval === 'annual' ? annualPrice(plan.id) : plan.price}
                </span>
                <span className="mb-0.5 text-sm text-muted-foreground">
                  {interval === 'annual' ? '/year' : '/month'}
                </span>
              </div>
              <p className="mb-4 h-4 text-[11px] text-emerald-400">
                {interval === 'annual'
                  ? `You save $${annualSavings(plan.id)}/yr vs monthly`
                  : ''}
              </p>
              <ul className="flex-1 space-y-1.5 mb-5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <span className="text-amber-400 mt-0.5 shrink-0">✓</span>
                    <span className="text-foreground/85">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  Pay with USDT TRC20 (Binance)
                </div>
                {isCurrent ? (
                  <div className="block rounded-md border border-border bg-muted/30 px-4 py-2.5 text-center text-sm font-semibold text-muted-foreground">
                    Current plan
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSelectPlan(plan.id)}
                    disabled={creating}
                    className={cn(
                      'block w-full text-center text-sm',
                      (plan.highlight || isVip) ? 'btn-premium' : 'btn-glass justify-center',
                      creating && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {creating && selectedPlan === plan.id ? 'Loading…' : `Get ${plan.name}`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PaymentInstructions({
  session,
  onContinue,
}: {
  session: PaymentSession
  onContinue: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyAddress() {
    await navigator.clipboard.writeText(session.wallet_address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const expiresIn = Math.max(
    0,
    Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000 / 60)
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => window.location.reload()} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </button>
        <h2 className="font-semibold">Send payment</h2>
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
        {/* Amount */}
        <div className="text-center pb-3 border-b border-border">
          <p className="text-sm text-muted-foreground">Send exactly</p>
          <p className="text-4xl font-extrabold mt-1">
            {session.amount_usd} <span className="text-xl text-muted-foreground">USDT</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Network: <strong>{session.network}</strong> (TRC20) · Token: <strong>{session.currency}</strong>
          </p>
        </div>

        {/* Wallet address */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Recipient Wallet Address (TRC20 only)
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-3">
            <code className="flex-1 text-xs break-all font-mono">{session.wallet_address}</code>
            <button
              onClick={copyAddress}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                copied
                  ? 'bg-green-600 text-white'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Warning */}
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-xs text-yellow-800 space-y-1">
          <p className="font-bold">⚠️ Important — read before sending:</p>
          <p>• Send ONLY on the <strong>TRC20 network</strong>. Other networks will result in permanent loss of funds.</p>
          <p>• Send exactly <strong>{session.amount_usd} USDT</strong>. Wrong amounts may delay activation.</p>
          <p>• This payment link expires in <strong>{expiresIn} minutes</strong>.</p>
        </div>
      </div>

      <button
        onClick={onContinue}
        className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        I've sent the payment — submit proof →
      </button>
    </div>
  )
}
