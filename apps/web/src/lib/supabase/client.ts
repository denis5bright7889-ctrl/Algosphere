import { createBrowserClient } from '@supabase/ssr'
// Database type intentionally NOT bound here (see server.ts note). Available
// for opt-in use:  `import type { Database } from './database.types'`.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
