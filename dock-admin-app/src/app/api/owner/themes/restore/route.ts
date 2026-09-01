export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { normalize, requireOwner } from '@/lib/ownerServer'

async function listThemes(service: any) {
  const { data, error } = await service.from('dock_themes').select('*').order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error

    const body = await request.json()
    const themeId = normalize(body?.themeId)
    const versionId = normalize(body?.versionId)
    const reason = normalize(body?.reason)

    if (!themeId || !versionId) {
      return NextResponse.json({ error: 'themeId and versionId are required.' }, { status: 400 })
    }
    if (reason.length < 5) {
      return NextResponse.json({ error: 'A restore reason of at least 5 characters is required.' }, { status: 400 })
    }

    const { data: restored, error } = await auth.service.rpc('dock_owner_restore_theme_version', {
      p_theme_id: themeId,
      p_version_id: versionId,
      p_actor_email: auth.ownerEmail,
      p_reason: reason,
    })
    if (error) throw error

    const { data: versions, error: versionsError } = await auth.service.from('dock_theme_versions')
      .select('id,theme_id,version,name,definition,created_by,created_at')
      .eq('theme_id', themeId)
      .order('version', { ascending: false })
    if (versionsError) throw versionsError

    return NextResponse.json({ ok: true, theme: restored, themes: await listThemes(auth.service), versions: versions || [] })
  } catch (error: any) {
    console.error('Dock HQ theme restore failed', error)
    return NextResponse.json({ error: error?.message || 'Theme restore failed.' }, { status: 400 })
  }
}
