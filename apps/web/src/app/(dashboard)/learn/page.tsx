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

export default async function LearnPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
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
            href={`/dashboard/learn/${c.slug}`}
            className="group rounded-2xl border border-border bg-card p-5 hover:border-amber-500/40 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <span className="text-3xl">{c.icon}</span>
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
