import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import MobileNav from './MobileNav'
import UserMenu from './UserMenu'
import NotificationBell from '@/components/social/NotificationBell'

export default async function TopBar() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, subscription_tier')
    .eq('id', user!.id)
    .single()

  const admin = isAdmin(user!.email)

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4 md:px-6">
      <MobileNav />
      <div className="hidden md:flex items-center gap-3">
        {admin && (
          <a
            href="/admin/payments"
            className="rounded-md bg-red-100 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-200"
          >
            Admin ↗
          </a>
        )}
      </div>
      <div className="flex items-center gap-1">
        <NotificationBell />
        <UserMenu
          email={user!.email ?? ''}
          name={profile?.full_name ?? ''}
          tier={profile?.subscription_tier ?? 'free'}
        />
      </div>
    </header>
  )
}
