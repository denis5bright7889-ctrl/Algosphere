import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('profiles')
    .update({
      account_type:        'live',
      demo_plan:           null,
      demo_converted_at:   new Date().toISOString(),
    })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to exit demo: ' + error.message }, { status: 500 })
  }
  return NextResponse.json({ exited: true })
}
