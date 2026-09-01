export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function norm(value: unknown) {
  return String(value || '').trim()
}

function inferContentType(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}

export async function GET(request: NextRequest) {
  try {
    const id = norm(request.nextUrl.searchParams.get('id'))
    const token = norm(request.nextUrl.searchParams.get('token'))
    if (!id || !token) return NextResponse.json({ error: 'Screenshot reference is invalid.' }, { status: 400 })

    const service = serviceClient()
    const { data: memory, error: memoryError } = await service
      .from('personal_memories')
      .select('id,user_id,screenshot_path,screenshot_access_token,deleted_at')
      .eq('id', id)
      .eq('screenshot_access_token', token)
      .is('deleted_at', null)
      .maybeSingle()

    if (memoryError) throw memoryError
    if (!memory?.user_id || !memory?.screenshot_path) {
      return NextResponse.json({ error: 'Screenshot not found.' }, { status: 404 })
    }

    const { data: allowed, error: accessError } = await service.rpc('dock_user_access_allowed', {
      p_user_id: memory.user_id,
      p_organization_id: null,
    })
    if (accessError) throw accessError
    if (!allowed) return NextResponse.json({ error: 'Screenshot access is disabled.' }, { status: 403 })

    const expectedPrefix = `${memory.user_id}/`
    const path = norm(memory.screenshot_path)
    if (!path.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: 'Screenshot reference is invalid.' }, { status: 403 })
    }

    const { data: blob, error: downloadError } = await service.storage
      .from('memory-screenshots')
      .download(path)
    if (downloadError || !blob) {
      return NextResponse.json({ error: 'Screenshot not found.' }, { status: 404 })
    }

    const bytes = await blob.arrayBuffer()
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': blob.type || inferContentType(path),
        'Cache-Control': 'private, max-age=60, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error: any) {
    console.error('Dock memory screenshot delivery failed', error)
    return NextResponse.json({ error: error?.message || 'Screenshot delivery failed.' }, { status: 500 })
  }
}
