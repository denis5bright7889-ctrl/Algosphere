import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const BUCKET    = 'trade-screenshots'
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED   = ['image/png', 'image/jpeg', 'image/webp']

// Upload a trade screenshot, return public URL.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 422 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Max 5MB' }, { status: 413 })
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: 'PNG / JPEG / WebP only' }, { status: 415 })
  }

  const ext = file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const svc = createServiceClient()

  // Ensure bucket exists (idempotent)
  await svc.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ALLOWED,
  }).catch(() => {})

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await svc.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (upErr) {
    console.error('screenshot upload error:', upErr)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: pub } = svc.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: pub.publicUrl, path })
}
