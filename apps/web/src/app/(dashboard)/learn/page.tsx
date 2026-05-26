import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { COURSES, totalLessons } from '@/lib/education'
import LearnProgress from './LearnProgress'

export const metadata = { title: 'Education Hub — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const LEVEL_CLS: Record<string, string> = {
  beginner:     'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  intermediate: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  advanced:     'text-rose-300 border-rose-500/30 bg-rose-500/10',
}

/**
 * Resolve the signed-in user defensively. The (dashboard) layout already
 * enforces auth before this renders, so a transient Supabase/env failure
 * here must NOT crash the page — the curriculum is fully static and safe
 * to show. We only force a /login redirect when auth definitively
 * reports no session (not when the lookup itself errors).
 */
async function ensureAuthedOrRender(): Promise<void> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    // Misconfigured env: the layout couldn't have admitted an unauthed
    // user anyway. Render the static hub rather than hard-crash.
    console.error('[learn] Supabase env missing — rendering hub without auth recheck')
    return
  }
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error) {
      console.error('[learn] auth lookup failed, rendering anyway:', error.message)
      return
    }
    if (!user) redirect('/login')
  } catch (e) {
    // redirect() throws a NEXT_REDIRECT control-flow signal — re-throw it
    // so navigation still works; swallow only genuine failures.
    if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e
    if (
      typeof e === 'object' && e !== null &&
      'digest' in e && typeof (e as { digest: unknown }).digest === 'string' &&
      (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) throw e
    console.error('[learn] auth check threw, rendering hub anyway:', e)
  }
}

export default async function LearnPage() {
  await ensureAuthedOrRender()

  return (
    <div className="mx-auto max-w-4xl px-1 py-4 sm:px-4 sm:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Education <span className="text-gradient">Hub</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          {COURSES.length} courses · {totalLessons()} lessons · self-paced.
        </p>
      </header>

      <LearnProgress total={totalLessons()} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
        {COURSES.map(c => (
          <a
            key={c.slug}
            href={`/learn/${c.slug}`}
            className="group rounded-2xl border border-border bg-card p-5 hover:border-amber-500/40 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <c.icon className="h-7 w-7 text-amber-300/90" strokeWidth={1.5} aria-hidden />
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${LEVEL_CLS[c.level]}`}>
                {c.level}
              </span>
            </div>
            <h3 className="font-bold text-base group-hover:text-amber-300 transition-colors">
              {c.title}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">{c.description}</p>
            <p className="text-[11px] text-muted-foreground mt-3">
              {c.lessons.length} lessons · {c.lessons.reduce((s, l) => s + l.minutes, 0)} min
            </p>
          </a>
        ))}
      </div>
    </div>
  )
}
