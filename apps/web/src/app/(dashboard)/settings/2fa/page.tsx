import { redirect } from 'next/navigation'
import { ChevronLeft, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import TwoFactorClient from './TwoFactorClient'

export const metadata = { title: 'Two-Factor Authentication' }
export const dynamic = 'force-dynamic'

export default async function TwoFactorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Initial factor list — listFactors() in this SDK version returns only
  // verified factors, which is exactly what we need for the first paint.
  // Any half-enrolled (unverified) factors are reaped client-side on
  // mount so a re-entry into the page starts clean.
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const verified = (factors?.totp ?? [])[0] ?? null

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
      <header>
        <a href="/settings" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          Back to Settings
        </a>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ShieldCheck className="h-6 w-6 text-amber-300" strokeWidth={1.75} aria-hidden />
          Two-Factor Authentication
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Adds a 6-digit code from an authenticator app (Google Authenticator, 1Password,
          Authy, etc.) to your sign-in. Strongly recommended.
        </p>
      </header>

      <TwoFactorClient initialVerifiedFactorId={verified?.id ?? null} />
    </div>
  )
}
