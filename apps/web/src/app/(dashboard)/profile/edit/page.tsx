import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PublicProfileForm from '@/app/(dashboard)/settings/PublicProfileForm'

export const metadata = { title: 'Edit Profile — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function ProfileEditPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('public_profile, public_handle, bio')
    .eq('id', user.id)
    .single()

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Edit <span className="text-gradient">Public Profile</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Control how you appear on the leaderboard and to copy followers.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-6">
        <PublicProfileForm
          initialEnabled={profile?.public_profile ?? false}
          initialHandle={profile?.public_handle ?? ''}
          initialBio={profile?.bio ?? ''}
        />
      </div>

      <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          Once your handle is live, your profile is reachable at{' '}
          {profile?.public_handle ? (
            <a
              href={`/traders/${profile.public_handle}`}
              className="text-amber-300 hover:underline"
            >
              /traders/{profile.public_handle}
            </a>
          ) : (
            <code className="text-foreground">/traders/your-handle</code>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Want a verification badge?{' '}
          <a href="/dashboard/verification" className="text-amber-300 hover:underline">
            Check your verification status →
          </a>
        </p>
      </div>
    </div>
  )
}
