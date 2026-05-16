import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { findCourse } from '@/lib/education'
import LessonView from './LessonView'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: { params: Promise<{ course: string }> }) {
  const { course } = await params
  const c = findCourse(course)
  return { title: `${c?.title ?? 'Course'} — AlgoSphere Quant` }
}

export default async function CoursePage({
  params,
}: { params: Promise<{ course: string }> }) {
  const { course } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const c = findCourse(course)
  if (!c) notFound()

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <a
        href="/dashboard/learn"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4"
      >
        ← Education Hub
      </a>
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{c.icon}</span>
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
