import { createClient } from '@/lib/supabase/server'
import JournalClient from './JournalClient'
import { isDemo } from '@/lib/demo'
import { generateDemoJournal } from '@/lib/demo-data'
import type { JournalEntry } from '@/lib/types'

export const metadata = { title: 'Trade Journal' }

export default async function JournalPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: profile }, { data: entries }] = await Promise.all([
    supabase.from('profiles').select('account_type').eq('id', user!.id).single(),
    supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', user!.id)
      .order('trade_date', { ascending: false }),
  ])

  let displayEntries = (entries ?? []) as JournalEntry[]

  // Demo accounts with an empty journal get prefilled mock trades so analytics
  // looks alive. Once they save a real entry, demo entries disappear.
  if (isDemo(profile?.account_type) && displayEntries.length === 0) {
    displayEntries = generateDemoJournal(user!.id, 25)
  }

  return <JournalClient initialEntries={displayEntries} userId={user!.id} />
}
