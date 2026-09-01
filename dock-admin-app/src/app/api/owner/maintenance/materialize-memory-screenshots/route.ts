export const dynamic = 'force-dynamic'

import { createHash } from 'crypto'
import { Buffer } from 'buffer'
import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/ownerServer'

const BUCKET = 'memory-screenshots'
const MAX_BYTES = 600_000

function normalize(value: unknown) {
  return String(value || '').trim()
}

function parseDataImage(value: unknown) {
  const raw = normalize(value)
  const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i)
  if (!match) throw new Error('INVALID_SCREENSHOT_DATA_URL')
  const contentType = match[1].toLowerCase().replace('image/jpg', 'image/jpeg')
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('SCREENSHOT_TOO_LARGE')
  const ext = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]
  return { buffer, contentType, ext }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error

    const body = await request.json().catch(() => ({}))
    const confirmation = normalize(body?.confirmation)
    if (confirmation !== 'MATERIALIZE') {
      return NextResponse.json({ error: 'Type MATERIALIZE to authorize this migration.' }, { status: 400 })
    }

    const { data: rows, error: loadError } = await auth.service
      .from('personal_memories')
      .select('id,user_id,screenshot_data_url')
      .is('deleted_at', null)
      .is('screenshot_path', null)
      .not('screenshot_data_url', 'is', null)
      .neq('screenshot_data_url', '')
      .order('created_at', { ascending: true })
      .limit(500)
    if (loadError) throw loadError

    const refs: Array<{ id: string; user_id: string; screenshot_path: string }> = []
    const failures: Array<{ id: string; code: string }> = []

    for (const row of rows || []) {
      const id = normalize(row?.id)
      const userId = normalize(row?.user_id)
      try {
        if (!id || !userId) throw new Error('INVALID_MEMORY_IDENTITY')
        const parsed = parseDataImage(row?.screenshot_data_url)
        const hash = createHash('sha256').update(parsed.buffer).digest('hex')
        const path = `${userId}/legacy-${id}-${hash.slice(0, 20)}.${parsed.ext}`

        const { error: uploadError } = await auth.service.storage
          .from(BUCKET)
          .upload(path, parsed.buffer, {
            contentType: parsed.contentType,
            cacheControl: '31536000',
            upsert: true,
          })
        if (uploadError) throw new Error(`SCREENSHOT_UPLOAD_FAILED:${uploadError.message}`)
        refs.push({ id, user_id: userId, screenshot_path: path })
      } catch (error: any) {
        failures.push({ id: id || 'unknown', code: normalize(error?.message) || 'MIGRATION_FAILED' })
      }
    }

    if (failures.length) {
      return NextResponse.json({
        ok: false,
        found: (rows || []).length,
        prepared: refs.length,
        failed: failures.length,
        failures,
        message: 'No memory references were changed. Fix upload/validation failures and rerun.',
      }, { status: 409 })
    }

    const { data: applied, error: applyError } = await auth.service.rpc('dock_owner_apply_legacy_memory_screenshot_refs', {
      p_refs: refs,
      p_actor_email: auth.ownerEmail,
    })
    if (applyError) throw applyError

    const { count: remainingActive, error: remainingError } = await auth.service
      .from('personal_memories')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .is('screenshot_path', null)
      .not('screenshot_data_url', 'is', null)
      .neq('screenshot_data_url', '')
    if (remainingError) throw remainingError

    const { count: deletedLegacy, error: deletedError } = await auth.service
      .from('personal_memories')
      .select('id', { count: 'exact', head: true })
      .not('deleted_at', 'is', null)
      .not('screenshot_data_url', 'is', null)
      .neq('screenshot_data_url', '')
    if (deletedError) throw deletedError

    return NextResponse.json({
      ok: (remainingActive || 0) === 0,
      found: (rows || []).length,
      migrated: Number(applied?.migrated || refs.length || 0),
      failed: 0,
      remainingActive: remainingActive || 0,
      deletedLegacyRemaining: deletedLegacy || 0,
      applied,
    }, { status: (remainingActive || 0) ? 409 : 200 })
  } catch (error: any) {
    console.error('Dock legacy memory screenshot materialization failed', error)
    return NextResponse.json({ error: error?.message || 'Legacy memory screenshot materialization failed.' }, { status: 400 })
  }
}
