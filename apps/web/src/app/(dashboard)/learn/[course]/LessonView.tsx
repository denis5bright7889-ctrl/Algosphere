'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { Course } from '@/lib/education'
import { getCompleted, markComplete } from '../LearnProgress'

export default function LessonView({ course }: { course: Course }) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [completed, setCompleted] = useState<Set<string>>(new Set())

  useEffect(() => { setCompleted(getCompleted()) }, [])

  const lesson = course.lessons[activeIdx]
  if (!lesson) return null
  const lessonId = `${course.slug}/${lesson.slug}`
  const isDone   = completed.has(lessonId)

  function complete() {
    markComplete(lessonId)
    setCompleted(getCompleted())
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
      {/* Lesson list */}
      <nav className="space-y-1 md:sticky md:top-20 md:self-start">
        {course.lessons.map((l, i) => {
          const done = completed.has(`${course.slug}/${l.slug}`)
          return (
            <button
              key={l.slug}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors',
                i === activeIdx
                  ? 'bg-amber-500/10 text-amber-300 font-semibold'
                  : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground',
              )}
            >
              <span>{done ? '✓' : '○'}</span>
              <span className="flex-1">{l.title}</span>
            </button>
          )
        })}
      </nav>

      {/* Lesson body */}
      <article className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Lesson {activeIdx + 1} of {course.lessons.length} · {lesson.minutes} min
          </span>
          {isDone && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
              ✓ Completed
            </span>
          )}
        </div>
        <h2 className="text-xl font-bold tracking-tight mb-3">{lesson.title}</h2>

        <div className="space-y-3 text-sm leading-relaxed">
          {lesson.body.map((p, i) => <p key={i}>{p}</p>)}
        </div>

        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4">
          <p className="text-[10px] uppercase tracking-wider text-amber-300 font-bold mb-2">
            Key Takeaways
          </p>
          <ul className="space-y-1.5">
            {lesson.takeaways.map((t, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-amber-300">✓</span>{t}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            disabled={activeIdx === 0}
            onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
            className={cn(
              'rounded-lg border border-border px-4 py-2 text-xs font-medium',
              activeIdx === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-muted/30',
            )}
          >
            ← Previous
          </button>
          {!isDone ? (
            <button type="button" onClick={complete} className="btn-premium !text-xs !py-2 !px-5">
              Mark Complete
            </button>
          ) : activeIdx < course.lessons.length - 1 ? (
            <button
              type="button"
              onClick={() => setActiveIdx(i => i + 1)}
              className="btn-premium !text-xs !py-2 !px-5"
            >
              Next Lesson →
            </button>
          ) : (
            <a href="/dashboard/learn" className="btn-premium !text-xs !py-2 !px-5">
              Finish Course
            </a>
          )}
        </div>
      </article>
    </div>
  )
}
