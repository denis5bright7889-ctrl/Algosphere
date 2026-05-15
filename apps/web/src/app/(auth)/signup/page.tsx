import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SignupForm from './SignupForm'
import Logo from '@/components/brand/Logo'

export const metadata = { title: 'Create account' }

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/overview')

  const { ref } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <Logo size="lg" priority />
          </div>
          <h1 className="text-2xl font-bold">Start your free trial</h1>
          <p className="mt-1 text-sm text-muted-foreground">7 days free, no card required</p>
        </div>
        <SignupForm referralCode={ref} />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <a href="/login" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </a>
        </p>
      </div>
    </main>
  )
}
