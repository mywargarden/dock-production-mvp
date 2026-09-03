import { createClient, type User } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

const MAX_SHARE_REQUEST_CHARS = 3_000_000
const MAX_SHARE_PAYLOAD_CHARS = 2_500_000
const MAX_SHARE_TABS = 100
const MAX_PREVIEW_CHARS = 100_000

function norm(value: unknown) {
  return String(value ?? '').trim()
}

function requireSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceRoleKey) throw new Error('Supabase configuration is unavailable.')
  return { url, anonKey, serviceRoleKey }
}

export function getShareAdminClient() {
  const { url, serviceRoleKey } = requireSupabaseConfig()
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function requireDockShareUser(request: NextRequest): Promise<User> {
  const { url, anonKey } = requireSupabaseConfig()
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw Object.assign(new Error('Authentication is required.'), { status: 401, code: 'AUTH_REQUIRED' })

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user?.id) {
    throw Object.assign(new Error('Invalid auth token.'), { status: 401, code: 'INVALID_AUTH_TOKEN' })
  }

  const { data: allowed, error: accessError } = await supabase.rpc('dock_user_access_allowed', {
    p_user_id: user.id,
    p_organization_id: null,
  })
  if (accessError) {
    throw Object.assign(new Error('Could not verify Dock access.'), { status: 500, code: 'ACCESS_CHECK_FAILED' })
  }
  if (!allowed) {
    throw Object.assign(new Error('Dock access is disabled or unauthorized.'), { status: 403, code: 'ACCESS_DENIED' })
  }

  return user
}

function sanitizeHttpUrl(value: unknown, maxLength = 2000) {
  const raw = norm(value)
  if (!raw || raw.length > maxLength) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.toString().slice(0, maxLength)
  } catch {
    return ''
  }
}

function sanitizePreview(value: unknown) {
  const raw = norm(value)
  if (!raw) return ''
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(raw)) {
    return raw.length <= MAX_PREVIEW_CHARS ? raw : ''
  }
  return sanitizeHttpUrl(raw)
}

function safeColor(value: unknown) {
  const raw = norm(value)
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#6f4cff'
}

export function sanitizeDockSharePayload(input: unknown) {
  const raw = input && typeof input === 'object' ? input as Record<string, any> : null
  const workspace = raw?.workspace && typeof raw.workspace === 'object' ? raw.workspace : null
  if (!workspace || !Array.isArray(workspace.tabs)) throw new Error('Invalid Dock share payload.')

  const tabs = workspace.tabs.slice(0, MAX_SHARE_TABS).flatMap((tab: any) => {
    const url = sanitizeHttpUrl(tab?.url)
    if (!url) return []
    const preview = sanitizePreview(
      tab?.screenshot_url || tab?.screenshotUrl || tab?.screenshotThumb || tab?.screenshot || tab?.screenshot_data_url
    )
    return [{
      title: norm(tab?.title).slice(0, 200) || url,
      url,
      reason: norm(tab?.reason).slice(0, 500),
      faviconUrl: sanitizeHttpUrl(tab?.faviconUrl || tab?.icon_url, 2000) || null,
      savedAt: Number.isFinite(Number(tab?.savedAt)) ? Number(tab.savedAt) : Date.now(),
      screenshot_url: preview || null,
      screenshotBlocked: preview ? false : Boolean(tab?.screenshotBlocked),
    }]
  })

  if (!tabs.length) throw new Error('This Dock has no shareable tabs.')

  const payload = {
    type: 'dock-workspace-share',
    version: 1,
    workspace: {
      name: norm(workspace.name).slice(0, 120) || 'Shared Dock',
      color: safeColor(workspace.color),
      tabs,
    },
  }

  let serialized = JSON.stringify(payload)
  if (serialized.length > MAX_SHARE_PAYLOAD_CHARS) {
    for (const tab of payload.workspace.tabs) {
      if (norm(tab.screenshot_url).startsWith('data:image/')) tab.screenshot_url = null
    }
    serialized = JSON.stringify(payload)
  }
  if (serialized.length > MAX_SHARE_PAYLOAD_CHARS) throw new Error('This Dock is too large to share in one link.')

  return payload
}

export function validateShareRequestText(raw: string) {
  if (!raw || raw.length > MAX_SHARE_REQUEST_CHARS) throw new Error('This Dock is too large to share in one link.')
  return raw
}

export function sanitizeChromeExtensionId(value: unknown) {
  const raw = norm(value).toLowerCase()
  return /^[a-p]{32}$/.test(raw) ? raw : ''
}

export function sanitizeShareId(value: unknown) {
  const raw = norm(value)
  return /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : ''
}

export function isExpired(expiresAt: unknown) {
  const raw = norm(expiresAt)
  if (!raw) return false
  const time = Date.parse(raw)
  return Number.isFinite(time) && time <= Date.now()
}
