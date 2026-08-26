export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { normalize, normalizeThemeSlug, requireOwner } from '@/lib/ownerServer'

function clamp(value: any, min: number, max: number, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

function normalizeDefinition(raw: any = {}) {
  const color = (value: any, fallback: string) => /^#[0-9a-f]{6}$/i.test(normalize(value)) ? normalize(value) : fallback
  const scene = normalize(raw.sceneImageUrl)
  const mode = ['color', 'gradient', 'image'].includes(normalize(raw.backgroundMode)) ? normalize(raw.backgroundMode) : 'color'
  const shadow = ['none', 'soft', 'medium', 'deep'].includes(normalize(raw.shadow)) ? normalize(raw.shadow) : 'soft'

  return {
    background: color(raw.background, '#f4f8fc'),
    foreground: color(raw.foreground, '#14263a'),
    muted: color(raw.muted, '#607286'),
    primary: color(raw.primary, '#2b8c8f'),
    secondary: color(raw.secondary, '#75a7c8'),
    accent: color(raw.accent, '#2b8c8f'),
    primaryText: color(raw.primaryText, '#ffffff'),
    card: color(raw.card, '#ffffff'),
    border: color(raw.border, '#d7e1eb'),
    radius: clamp(raw.radius, 0, 48, 16),
    cardOpacity: clamp(raw.cardOpacity, 0.2, 1, 0.88),
    borderOpacity: clamp(raw.borderOpacity, 0, 1, 0.55),
    borderWidth: clamp(raw.borderWidth, 0, 6, 1),
    shadow,
    backgroundMode: mode,
    gradientEnd: color(raw.gradientEnd, '#dcecf8'),
    gradientAngle: clamp(raw.gradientAngle, 0, 360, 135),
    sceneImageUrl: scene.startsWith('data:image/') || /^https?:\/\//i.test(scene) ? scene : '',
    imageOverlay: clamp(raw.imageOverlay, 0, 0.9, 0.18),
    imageBlur: clamp(raw.imageBlur, 0, 24, 0),
  }
}

async function listThemes(service: any) {
  const { data, error } = await service.from('dock_themes').select('*').order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function listVersions(service: any, themeId: string) {
  if (!themeId) return []
  const { data, error } = await service.from('dock_theme_versions')
    .select('id,theme_id,version,name,definition,created_by,created_at')
    .eq('theme_id', themeId)
    .order('version', { ascending: false })
  if (error) throw error
  return data || []
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error
    const themeId = normalize(request.nextUrl.searchParams.get('themeId'))
    return NextResponse.json({
      ok: true,
      themes: await listThemes(auth.service),
      versions: themeId ? await listVersions(auth.service, themeId) : [],
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not load themes.' }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error
    const body = await request.json()
    const action = normalize(body?.action) || 'save'
    const id = normalize(body?.id)
    const now = new Date().toISOString()

    if (['archive', 'restore'].includes(action)) {
      if (!id) return NextResponse.json({ error: 'Theme id is required.' }, { status: 400 })
      const { data: existing, error: existingError } = await auth.service.from('dock_themes').select('*').eq('id', id).single()
      if (existingError) throw existingError
      const status = action === 'archive' ? 'archived' : 'draft'
      const { data: theme, error } = await auth.service.from('dock_themes')
        .update({ status, updated_at: now })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      await auth.service.from('audit_logs').insert({
        organization_id: existing.organization_id || null,
        actor_email: auth.ownerEmail,
        action: action === 'archive' ? 'owner_archive_theme' : 'owner_restore_theme',
        target_type: 'dock_theme',
        target_id: id,
        details: { name: existing.name, slug: existing.slug, previousStatus: existing.status, nextStatus: status },
      }).throwOnError()
      return NextResponse.json({ ok: true, theme, themes: await listThemes(auth.service), versions: await listVersions(auth.service, id) })
    }

    if (!['save', 'publish'].includes(action)) {
      return NextResponse.json({ error: 'Unsupported theme action.' }, { status: 400 })
    }

    const name = normalize(body?.name) || 'Dock Theme'
    const slug = normalizeThemeSlug(body?.slug || name)
    const organizationId = normalize(body?.organizationId) || null
    const definition = normalizeDefinition(body?.definition)
    let theme: any = null

    if (id) {
      const { data: existing, error: existingError } = await auth.service.from('dock_themes').select('*').eq('id', id).single()
      if (existingError) throw existingError
      if (existing.status === 'archived') return NextResponse.json({ error: 'Restore this theme before editing it.' }, { status: 400 })
      const nextVersion = Math.max(1, Number(existing.version) || 1) + 1
      const { data, error } = await auth.service.from('dock_themes').update({
        name,
        slug,
        organization_id: organizationId,
        scope: organizationId ? 'district' : 'global',
        status: action === 'publish' ? 'published' : 'draft',
        definition,
        version: nextVersion,
        updated_at: now,
        published_at: action === 'publish' ? now : existing.published_at,
      }).eq('id', id).select('*').single()
      if (error) throw error
      theme = data
      await auth.service.from('dock_theme_versions').insert({
        theme_id: id,
        version: nextVersion,
        definition,
        name,
        created_by: auth.ownerEmail,
      }).throwOnError()
    } else {
      const { data, error } = await auth.service.from('dock_themes').insert({
        name,
        slug,
        organization_id: organizationId,
        scope: organizationId ? 'district' : 'global',
        status: action === 'publish' ? 'published' : 'draft',
        definition,
        version: 1,
        created_by: auth.ownerEmail,
        updated_at: now,
        published_at: action === 'publish' ? now : null,
      }).select('*').single()
      if (error) throw error
      theme = data
      await auth.service.from('dock_theme_versions').insert({
        theme_id: theme.id,
        version: 1,
        definition,
        name,
        created_by: auth.ownerEmail,
      }).throwOnError()
    }

    if (action === 'publish' && organizationId) {
      await auth.service.from('organizations').update({ default_theme: slug, updated_at: now }).eq('id', organizationId).throwOnError()
    }

    await auth.service.from('audit_logs').insert({
      organization_id: organizationId,
      actor_email: auth.ownerEmail,
      action: action === 'publish' ? 'owner_publish_theme' : 'owner_save_theme',
      target_type: 'dock_theme',
      target_id: theme.id,
      details: {
        name,
        slug,
        version: theme.version,
        scope: organizationId ? 'district' : 'global',
        backgroundMode: definition.backgroundMode,
        hasBackgroundImage: Boolean(definition.sceneImageUrl),
      },
    }).throwOnError()

    return NextResponse.json({
      ok: true,
      theme,
      themes: await listThemes(auth.service),
      versions: await listVersions(auth.service, theme.id),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not save theme.' }, { status: 400 })
  }
}
