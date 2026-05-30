import { notFound } from 'next/navigation'
import { createClient as serviceClient } from '@supabase/supabase-js'
import ContentDetailClient from './ContentDetailClient'

export const dynamic = 'force-dynamic'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const sb = db()
  const { data } = await sb
    .from('growth_content_items')
    .select('*')
    .eq('id', id)
    .single()

  if (!data) notFound()
  return <ContentDetailClient initial={data} />
}
