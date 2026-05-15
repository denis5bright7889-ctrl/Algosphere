import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LoginForm from './LoginForm'
import Logo from '@/components/brand/Logo'

export const metadata = { title: 'Sign in' }

export default async function LoginPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/overview')

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <Logo size="lg" priority />
          </div>
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your account</p>
        </div>
        <LoginForm />
        <p className="text-center text-sm text-muted-foreground">
          No account?{' '}
          <a href="/signup" className="font-medium text-foreground underline underline-offset-4">
            Sign up free
          </a>
        </p>
      </div>
    </main>
  )
}
