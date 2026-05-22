import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TraderTypeWizard from './TraderTypeWizard'
import type { TraderType } from '@/lib/trader-type'

export const metadata = { title: 'Trader Type — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

/**
 * Onboarding wizard for trader-type classification. 4-question flow that
 * derives one of 8 archetypes. Drives risk-profile defaults, strategy
 * recommendations, and dashboard layout.
 *
 * Accessible at /onboarding/trader-type either via the post-signup redirect
 * (when trader_type is NULL) or from Settings (to re-classify).
 */
export default async function TraderTypeOnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('trader_type, classification_meta')
    .eq('id', user.id)
    .single()

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          What kind of <span className="text-gradient">trader</span> are you?
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Four questions. We use your answers to default your risk settings,
          recommend strategies that match your style, and pick which panels
          appear on your dashboard. You can change this anytime in Settings.
        </p>
      </header>

      <TraderTypeWizard
        initialType={(profile?.trader_type ?? null) as TraderType | null}
        initialAnswers={(profile?.classification_meta ?? null) as Record<string, string> | null}
      />
    </div>
  )
}
