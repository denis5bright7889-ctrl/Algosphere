import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component — can be ignored safely
          }
        },
      },
    }
  )
}

/**
 * Service-role client for server-side jobs that bypass RLS.
 * Only use from trusted server contexts (relays, webhooks, cron).
 * Never expose to a client component or unauthenticated route.
 */
export function createServiceClient() {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) {
    throw new Error('Supabase service role credentials missing')
  }
  return createSupabaseClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
