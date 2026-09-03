import { NextRequest, NextResponse } from 'next/server'
import {
  getShareAdminClient,
  requireDockShareUser,
  sanitizeDockSharePayload,
  sanitizeShareId,
  validateShareRequestText,
} from '@/lib/shareServer'

const SHARE_TTL_DAYS = 30
const CANONICAL_CHROME_EXTENSION_ID = 'ljbeicldjiaglnflgnlmafnalpmapdne'

function failure(error: any) {
  const status = Number(error?.status) || 400
  const code = String(error?.code || (status >= 500 ? 'SHARE_SERVER_ERROR' : 'INVALID_SHARE_REQUEST'))
  return NextResponse.json(
    { error: String(error?.message || 'Share request failed.'), code },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

function newShareId() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireDockShareUser(request)
    const rawBody = validateShareRequestText(await request.text())
    let body: any = null
    try { body = JSON.parse(rawBody) } catch { throw new Error('Invalid Dock share payload.') }

    const payload = sanitizeDockSharePayload(body?.payload ?? body)
    const claimedExtensionId = String(body?.extensionId || request.headers.get('x-dock-extension-id') || '').trim().toLowerCase()
    if (claimedExtensionId && claimedExtensionId !== CANONICAL_CHROME_EXTENSION_ID) {
      throw Object.assign(new Error('This Dock client does not match the supported Chrome extension.'), {
        status: 400,
        code: 'EXTENSION_ID_MISMATCH',
      })
    }

    const id = newShareId()
    const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const service = getShareAdminClient()

    const { error } = await service.from('dock_shares').insert({
      id,
      created_by: user.id,
      extension_id: CANONICAL_CHROME_EXTENSION_ID,
      payload,
      expires_at: expiresAt,
    })
    if (error) throw Object.assign(new Error('Could not create Dock share.'), { status: 500, code: 'SHARE_CREATE_FAILED' })

    return NextResponse.json({
      ok: true,
      id,
      url: `${request.nextUrl.origin}/share/${id}`,
      expiresAt,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return failure(error)
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireDockShareUser(request)
    const id = sanitizeShareId(request.nextUrl.searchParams.get('id'))
    if (!id) throw Object.assign(new Error('Invalid Dock share link.'), { status: 400, code: 'INVALID_SHARE_ID' })

    const service = getShareAdminClient()
    const { data, error } = await service
      .from('dock_shares')
      .select('id,payload,expires_at')
      .eq('id', id)
      .maybeSingle()
    if (error) throw Object.assign(new Error('Could not read Dock share.'), { status: 500, code: 'SHARE_READ_FAILED' })
    if (!data) throw Object.assign(new Error('This Dock share could not be found.'), { status: 404, code: 'SHARE_NOT_FOUND' })
    if (data.expires_at && Date.parse(data.expires_at) <= Date.now()) {
      throw Object.assign(new Error('This Dock share has expired.'), { status: 410, code: 'SHARE_EXPIRED' })
    }

    return NextResponse.json({ ok: true, id: data.id, payload: data.payload, expiresAt: data.expires_at }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return failure(error)
  }
}