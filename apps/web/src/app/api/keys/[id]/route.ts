/**
 * DELETE /api/keys/[id] → revoke a key the caller owns.
 * We soft-revoke (revoked=true) rather than delete so usage history /
 * audit trail survives. RLS scopes the update to the owner.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('api_keys')
    .update({ revoked: true })
    .eq('id', id)
    .eq('user_id', user.id)   // defence-in-depth on top of RLS
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Key not found' }, { status: 404 })
  return NextResponse.json({ revoked: id })
}
