import { PlugZap, BrainCircuit, Rocket } from 'lucide-react'

const STEPS = [
  {
    icon: PlugZap,
    title: 'Connect',
    body: 'Link Binance, Bybit, OKX or MT5 in read-only first. No withdrawal scope, ever. Or just take the signals manually.',
  },
  {
    icon: BrainCircuit,
    title: 'Get AI signals',
    body: 'The regime-aware engine posts entries, stop-loss and layered take-profits — each one pre-checked by the 12-gate risk system.',
  },
  {
    icon: Rocket,
    title: 'Execute & track',
    body: 'Auto-mirror trades (shadow-validated before going live) and watch win-rate, R:R and P&L compute from real closed trades.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-14 sm:py-20">
      <div className="mb-10 text-center sm:mb-12">
        <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">
          How it works
        </span>
        <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          From signal to execution in <span className="text-gradient">three steps</span>
        </h2>
      </div>

      <ol className="grid gap-4 sm:gap-6 md:grid-cols-3">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          return (
            <li
              key={s.title}
              className="relative rounded-2xl border border-border bg-card p-5 sm:p-6"
            >
              <span className="absolute right-4 top-4 text-4xl font-extrabold leading-none text-muted-foreground/10">
                {i + 1}
              </span>
              <Icon className="h-7 w-7 text-amber-300/90" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-3 text-base font-bold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
