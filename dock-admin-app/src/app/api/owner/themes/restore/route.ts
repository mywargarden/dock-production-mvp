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

    const [{ data: theme, error: themeError }, { data: version, error: versionError }] = await Promise.all([
      auth.service.from('dock_themes').select('*').eq('id', themeId).maybeSingle(),
      auth.service.from('dock_theme_versions').select('*').eq('id', versionId).eq('theme_id', themeId).maybeSingle(),
    ])
    if (themeError) throw themeError
    if (versionError) throw versionError
    if (!theme || !version) return NextResponse.json({ error: 'Theme or theme version was not found.' }, { status: 404 })
    if (theme.status === 'archived') return NextResponse.json({ error: 'Restore the archived theme before restoring one of its versions.' }, { status: 400 })

    const now = new Date().toISOString()
    const nextVersion = Math.max(1, Number(theme.version) || 1) + 1

    await auth.service.from('dock_theme_versions').insert({
      theme_id: theme.id,
      version: nextVersion,
      definition: version.definition,
      name: version.name || theme.name,
      created_by: auth.ownerEmail,
    }).throwOnError()

    const { data: restored, error: restoreError } = await auth.service.from('dock_themes').update({
      name: version.name || theme.name,
      definition: version.definition,
      version: nextVersion,
      status: 'draft',
      updated_at: now,
    }).eq('id', theme.id).select('*').single()
    if (restoreError) throw restoreError

    await auth.service.from('audit_logs').insert({
      organization_id: theme.organization_id || null,
      actor_email: auth.ownerEmail,
      action: 'owner_restore_theme_version',
      target_type: 'dock_theme',
      target_id: theme.id,
      details: {
        reason,
        restoredFromVersionId: version.id,
        restoredFromVersion: version.version,
        previousCurrentVersion: theme.version,
        newCurrentVersion: nextVersion,
        scope: theme.scope,
      },
    }).throwOnError()

    const { data: versions, error: versionsError } = await auth.service.from('dock_theme_versions')
      .select('id,theme_id,version,name,definition,created_by,created_at')
      .eq('theme_id', theme.id)
      .order('version', { ascending: false })
    if (versionsError) throw versionsError

    return NextResponse.json({ ok: true, theme: restored, themes: await listThemes(auth.service), versions: versions || [] })
  } catch (error: any) {
    console.error('Dock HQ theme restore failed', error)
    return NextResponse.json({ error: error?.message || 'Theme restore failed.' }, { status: 400 })
  }
}
