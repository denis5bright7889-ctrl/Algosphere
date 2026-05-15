'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface Props {
  referralCode?: string
}

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === 'true'

export default function SignupForm({ referralCode }: Props) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          referral_code: referralCode,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSuccess(true)
    }
  }

  async function handleGoogleSignup() {
    setOauthLoading(true)
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: referralCode ? { ref: referralCode } : undefined,
      },
    })
  }

  if (success) {
    return (
      <div className="rounded-md bg-green-50 border border-green-200 px-4 py-5 text-center space-y-1">
        <p className="font-semibold text-green-800">Check your email</p>
        <p className="text-sm text-green-700">
          We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
          account.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {GOOGLE_ENABLED && <button
        type="button"
        onClick={handleGoogleSignup}
        disabled={oauthLoading}
        className={cn(
          'flex w-full items-center justify-center gap-3 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-accent transition-colors',
          oauthLoading && 'opacity-50 cursor-not-allowed'
        )}
      >
        <GoogleIcon />
        {oauthLoading ? 'Redirecting…' : 'Continue with Google'}
      </button>}

      {GOOGLE_ENABLED && <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>}

      <form onSubmit={handleSignup} className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="full-name" className="text-sm font-medium">
            Full name
          </label>
          <input
            id="full-name"
            type="text"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Jane Doe"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Min. 8 characters"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className={cn(
            'w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors',
            loading && 'opacity-50 cursor-not-allowed'
          )}
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>
        <p className="text-center text-xs text-muted-foreground">
          By signing up you agree to our{' '}
          <a href="/terms" className="underline">
            Terms
          </a>{' '}
          &{' '}
          <a href="/privacy" className="underline">
            Privacy Policy
          </a>
          .
        </p>
      </form>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  )
}
