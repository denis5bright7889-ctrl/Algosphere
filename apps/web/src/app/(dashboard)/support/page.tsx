import SupportFormClient from './SupportFormClient'

export const metadata = { title: 'Support — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-2xl px-1 py-4 sm:px-4 sm:py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">
          Contact <span className="text-gradient">support</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Real humans, real answers. Most accounts hear back within a few hours during weekday EU/US hours.
        </p>
      </header>
      <SupportFormClient />
    </div>
  )
}
