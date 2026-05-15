import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!isAdmin(user.email)) redirect('/overview')

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          <a href="/overview" className="text-sm text-muted-foreground hover:text-foreground">
            ← Command Center
          </a>
          <span className="text-muted-foreground">|</span>
          {[
            { href: '/admin/dashboard', label: 'Platform Intelligence' },
            { href: '/admin/signals',   label: 'Signal Management' },
            { href: '/admin/payments',  label: 'Payments' },
          ].map(link => (
            <a key={link.href} href={link.href} className="text-sm text-muted-foreground hover:text-foreground">
              {link.label}
            </a>
          ))}
        </div>
        <span className="rounded-full bg-red-100 text-red-700 text-xs font-bold px-3 py-1">ADMIN</span>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
