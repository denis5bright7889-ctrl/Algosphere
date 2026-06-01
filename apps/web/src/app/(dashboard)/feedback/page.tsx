import BugReportClient from './BugReportClient'

export const metadata = { title: 'Report a bug — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default function FeedbackPage() {
  return (
    <div className="mx-auto max-w-2xl px-1 py-4 sm:px-4 sm:py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">
          Report a <span className="text-gradient">bug</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Anything misbehaving? Tell us exactly what you saw, what you expected, and where it happened. Goes straight to our Discord bug-reports channel.
        </p>
      </header>
      <BugReportClient />
    </div>
  )
}
