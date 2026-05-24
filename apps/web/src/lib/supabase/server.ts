import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
// Database type intentionally NOT bound on the global clients (the older
// @supabase/ssr 0.4.x narrows .from() results to never when the generic
// flows through, and supabase-js 2.43 rejects Record<string, unknown>
// payloads that the existing codebase uses for service-role inserts).
// Opt-in for callers that want typing:
//   import type { Database } from '@/lib/supabase/database.types'
//   type CopyJob = Database['public']['Tables']['copy_jobs']['Row']

export async function createClient() {
  const cookieStore = await cookies()

  // Note: NOT typed with <Database> because @supabase/ssr 0.4.x narrows
  // .from() results to never when the generic is set on createServerClient
  // (bug fixed in later major versions). Callers that want typing use the
  // explicit Database['public']['Tables'][...]['Row'] aliases from
  // database.types.ts. createServiceClient below IS typed because supabase-js
  // 2.43 handles the generic on createClient cleanly.
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
