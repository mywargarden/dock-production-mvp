import { NextRequest, NextResponse } from 'next/server'
import { getShareAdminClient, sanitizeShareId } from '@/lib/shareServer'

function norm(value: unknown) {
  return String(value ?? '').trim()
}

function inferContentType(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: NextRequest) {
  try {
    const id = sanitizeShareId(request.nextUrl.searchParams.get('id'))
    const token = norm(request.nextUrl.searchParams.get('token'))
    const tabIndex = Number(request.nextUrl.searchParams.get('tab'))

    if (!id || !/^[A-Za-z0-9_-]{24,128}$/.test(token) || !Number.isInteger(tabIndex) || tabIndex < 0 || tabIndex > 99) {
      return errorResponse('Shared screenshot reference is invalid.', 400)
    }

    const service = getShareAdminClient()
    const { data: share, error: shareError } = await service
      .from('dock_shares')
      .select('id,created_by,payload,expires_at')
      .eq('id', id)
      .maybeSingle()

    if (shareError) throw shareError
    if (!share) return errorResponse('Shared screenshot not found.', 404)
    if (share.expires_at && Date.parse(share.expires_at) <= Date.now()) {
      return errorResponse('This Dock share has expired.', 410)
    }

    const storedToken = norm(share?.payload?._sharePreviewToken)
    if (!storedToken || storedToken !== token) return errorResponse('Shared screenshot access is invalid.', 403)

    const tabs = Array.isArray(share?.payload?.workspace?.tabs) ? share.payload.workspace.tabs : []
    const memoryId = norm(tabs[tabIndex]?._sharePreviewMemoryId)
    const creatorId = norm(share.created_by)
    if (!memoryId || !creatorId) return errorResponse('Shared screenshot not found.', 404)

    const { data: memory, error: memoryError } = await service
      .from('personal_memories')
      .select('id,user_id,screenshot_path,deleted_at')
      .eq('id', memoryId)
      .eq('user_id', creatorId)
      .is('deleted_at', null)
      .maybeSingle()

    if (memoryError) throw memoryError
    const path = norm(memory?.screenshot_path)
    if (!path || !path.startsWith(`${creatorId}/`)) return errorResponse('Shared screenshot not found.', 404)

    const { data: blob, error: downloadError } = await service.storage
      .from('memory-screenshots')
      .download(path)
    if (downloadError || !blob) return errorResponse('Shared screenshot not found.', 404)

    const bytes = await blob.arrayBuffer()
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': blob.type || inferContentType(path),
        'Cache-Control': 'private, max-age=300, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch (error: any) {
    console.error('Dock shared screenshot delivery failed', error)
    return errorResponse(error?.message || 'Shared screenshot delivery failed.', 500)
  }
}
