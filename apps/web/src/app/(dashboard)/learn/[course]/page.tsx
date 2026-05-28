import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { findCourse } from '@/lib/education'
import LessonView from './LessonView'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: { params: Promise<{ course: string }> }) {
  try {
    const { course } = await params
    const c = findCourse(course)
    return { title: `${c?.title ?? 'Course'} — AlgoSphere Quant` }
  } catch {
    return { title: 'Course — AlgoSphere Quant' }
  }
}

/**
 * The (dashboard) layout already gates auth; a transient Supabase/env
 * failure here must not 500 the lesson. Only redirect to /login when
 * auth definitively reports no session.
 */
async function ensureAuthedOrRender(): Promise<void> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    console.error('[learn/course] Supabase env missing — rendering without auth recheck')
    return
  }
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error) {
      console.error('[learn/course] auth lookup failed, rendering anyway:', error.message)
      return
    }
    if (!user) redirect('/login')
  } catch (e) {
    if (
      typeof e === 'object' && e !== null &&
      'digest' in e && typeof (e as { digest: unknown }).digest === 'string' &&
      (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) throw e
    if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e
    console.error('[learn/course] auth check threw, rendering anyway:', e)
  }
}

export default async function CoursePage({
  params,
}: { params: Promise<{ course: string }> }) {
  const { course } = await params
  await ensureAuthedOrRender()

  const c = findCourse(course)
  if (!c) notFound()

  return (
    <div className="mx-auto max-w-3xl px-1 py-4 sm:px-4 sm:py-6">
      <a
        href="/learn"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4"
      >
        ← Education Hub
      </a>
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <c.icon className="h-9 w-9 shrink-0 text-amber-300/90" strokeWidth={1.5} aria-hidden />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{c.title}</h1>
            <p className="text-xs text-muted-foreground mt-1">{c.description}</p>
          </div>
        </div>
      </header>

      <LessonView course={c} />
    </div>
  )
}
