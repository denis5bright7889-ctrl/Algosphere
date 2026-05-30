import { createClient as serviceClient } from '@supabase/supabase-js'
import BrandSettingsClient from './BrandSettingsClient'

export const metadata = { title: 'Brand Settings — Growth Engine' }
export const dynamic = 'force-dynamic'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export default async function BrandSettingsPage() {
  const { data } = await db()
    .from('growth_brand_settings')
    .select('*')
    .eq('id', 1)
    .single()

  return <BrandSettingsClient initial={data ?? {
    brand_voice: '',
    signature: '',
    default_cta: '',
    default_cta_url: '',
    legal_footer: '',
    social: {},
  }} />
}
