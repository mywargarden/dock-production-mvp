import { NextRequest, NextResponse } from 'next/server'
import {
  getShareAdminClient,
  requireDockShareUser,
  sanitizeDockSharePayload,
  sanitizeShareId,
  validateShareRequestText,
} from '@/lib/shareServer'

const SHARE_TTL_DAYS = 30
const CANONICAL_CHROME_EXTENSION_ID = 'ljbeicldjiaglnflgnlmafhalpmdpdne'
const SHARE_PREVIEW_TOKEN_BYTES = 24

function failure(error: any) {
  const status = Number(error?.status) || 400
  const code = String(error?.code || (status >= 500 ? 'SHARE_SERVER_ERROR' : 'INVALID_SHARE_REQUEST'))
  return NextResponse.json(
    { error: String(error?.message || 'Share request failed.'), code },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

function randomToken(bytes = 18) {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return Buffer.from(value).toString('base64url')
}

function newShareId() {
  return randomToken(18)
}

async function attachOwnedPreviewReferences(service: any, userId: string, payload: any) {
  const tabs = Array.isArray(payload?.workspace?.tabs) ? payload.workspace.tabs : []
  const urls = Array.from(new Set(tabs.map((tab: any) => String(tab?.url || '').trim()).filter(Boolean)))
  const previewToken = randomToken(SHARE_PREVIEW_TOKEN_BYTES)
  if (!urls.length) return { ...payload, _sharePreviewToken: previewToken }

  const { data, error } = await service
    .from('personal_memories')
    .select('id,url,screenshot_path,updated_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .in('url', urls)
    .order('updated_at', { ascending: false })

  if (error) throw Object.assign(new Error('Could not resolve Dock screenshots for this share.'), {
    status: 500,
    code: 'SHARE_PREVIEW_LOOKUP_FAILED',
  })

  const previewByUrl = new Map<string, string>()
  for (const row of data || []) {
    const url = String(row?.url || '').trim()
    const memoryId = String(row?.id || '').trim()
    const path = String(row?.screenshot_path || '').trim()
    if (url && memoryId && path && !previewByUrl.has(url)) previewByUrl.set(url, memoryId)
  }

  return {
    ...payload,
    _sharePreviewToken: previewToken,
    workspace: {
      ...payload.workspace,
      tabs: tabs.map((tab: any) => ({
        ...tab,
        _sharePreviewMemoryId: previewByUrl.get(String(tab?.url || '').trim()) || null,
      })),
    },
  }
}

function publicSharePayload(request: NextRequest, shareId: string, storedPayload: any) {
  const workspace = storedPayload?.workspace && typeof storedPayload.workspace === 'object' ? storedPayload.workspace : null
  const previewToken = String(storedPayload?._sharePreviewToken || '').trim()
  if (!workspace || !Array.isArray(workspace.tabs)) return storedPayload

  return {
    type: storedPayload?.type || 'dock-workspace-share',
    version: Number(storedPayload?.version || 1),
    workspace: {
      name: workspace.name,
      color: workspace.color,
      tabs: workspace.tabs.map((tab: any, index: number) => {
        const memoryId = String(tab?._sharePreviewMemoryId || '').trim()
        const { _sharePreviewMemoryId: _privatePreviewMemoryId, ...publicTab } = tab || {}
        return {
          ...publicTab,
          ...(memoryId && previewToken ? {
            screenshot_url: `${request.nextUrl.origin}/api/share/preview?id=${encodeURIComponent(shareId)}&tab=${index}&token=${encodeURIComponent(previewToken)}`,
            screenshotBlocked: false,
          } : {}),
        }
      }),
    },
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireDockShareUser(request)
    const rawBody = validateShareRequestText(await request.text())
    let body: any = null
    try { body = JSON.parse(rawBody) } catch { throw new Error('Invalid Dock share payload.') }

    const sanitizedPayload = sanitizeDockSharePayload(body?.payload ?? body)
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
    const payload = await attachOwnedPreviewReferences(service, user.id, sanitizedPayload)

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

    const payload = publicSharePayload(request, data.id, data.payload)
    return NextResponse.json({ ok: true, id: data.id, payload, expiresAt: data.expires_at }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return failure(error)
  }
}
