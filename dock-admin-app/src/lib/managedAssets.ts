import { createHash } from 'crypto'
import { type SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'managed-assets'
const MAX_BYTES = 1_500_000

function normalize(value: unknown) {
  return String(value || '').trim()
}

function safeSegment(value: unknown, fallback: string) {
  const raw = normalize(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return raw || fallback
}

function parseDataImage(value: unknown) {
  const raw = normalize(value)
  if (!raw.startsWith('data:image/')) return null
  const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i)
  if (!match) throw new Error('INVALID_MANAGED_IMAGE')
  const contentType = match[1].toLowerCase().replace('image/jpg', 'image/jpeg')
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('MANAGED_IMAGE_TOO_LARGE')
  const ext = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]
  return { buffer, contentType, ext }
}

export async function materializeManagedImage(
  service: SupabaseClient,
  value: unknown,
  { orgCode, kind }: { orgCode: string; kind: string }
) {
  const raw = normalize(value)
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw

  const parsed = parseDataImage(raw)
  if (!parsed) return ''

  const hash = createHash('sha256').update(parsed.buffer).digest('hex')
  const path = `${safeSegment(orgCode, 'district')}/${safeSegment(kind, 'asset')}/${hash}.${parsed.ext}`

  const { error } = await service.storage
    .from(BUCKET)
    .upload(path, parsed.buffer, {
      contentType: parsed.contentType,
      cacheControl: '31536000',
      upsert: true,
    })
  if (error) throw new Error(`MANAGED_ASSET_UPLOAD_FAILED: ${error.message}`)

  const { data } = service.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = normalize(data?.publicUrl)
  if (!publicUrl) throw new Error('MANAGED_ASSET_URL_FAILED')
  return publicUrl
}

export async function materializeAdminWorkspaceAssets(
  service: SupabaseClient,
  payload: any
) {
  const orgCode = safeSegment(payload?.organization?.org_code, 'district')
  const organization = { ...(payload?.organization || {}) }

  organization.district_logo_url = await materializeManagedImage(service, organization.district_logo_url, {
    orgCode,
    kind: 'logo',
  }) || null
  organization.district_background_url = await materializeManagedImage(service, organization.district_background_url, {
    orgCode,
    kind: 'background',
  }) || null

  const tabs = []
  for (let index = 0; index < (Array.isArray(payload?.tabs) ? payload.tabs : []).length; index += 1) {
    const tab = payload.tabs[index]
    const iconUrl = await materializeManagedImage(service, tab?.icon_url, {
      orgCode,
      kind: `tab-icon-${index}`,
    })
    tabs.push({ ...tab, icon_url: iconUrl || null })
  }

  return { ...payload, organization, tabs }
}
