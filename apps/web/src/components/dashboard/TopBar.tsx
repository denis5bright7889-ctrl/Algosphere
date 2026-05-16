import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { Settings2 } from 'lucide-react'
import MobileNav from './MobileNav'
import UserMenu from './UserMenu'
import CommandPalette from './CommandPalette'
import CommandPaletteTrigger from './CommandPaletteTrigger'
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
    <header className="flex h-14 items-center justify-between border-b border-border/70 glass px-4 md:px-6">
      <CommandPalette />
      <div className="flex items-center gap-3">
        <MobileNav />
        <div className="hidden md:block">
          <CommandPaletteTrigger />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {admin && (
          <a
            href="/admin/dashboard"
            className="hidden md:flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20"
          >
            <Settings2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Admin
          </a>
        )}
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
