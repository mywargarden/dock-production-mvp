export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner, normalize, normalizeThemeSlug } from '@/lib/ownerServer'

function normalizeDefinition(raw: any = {}) {
  const color = (value: any, fallback: string) => /^#[0-9a-f]{6}$/i.test(normalize(value)) ? normalize(value) : fallback
  const radius = Math.max(0, Math.min(36, Number(raw.radius) || 16))
  const opacity = Math.max(0.2, Math.min(1, Number(raw.cardOpacity) || 0.88))
  const mode = ['color','gradient','image'].includes(normalize(raw.backgroundMode)) ? normalize(raw.backgroundMode) : 'color'
  const shadow = ['none','soft','medium','deep'].includes(normalize(raw.shadow)) ? normalize(raw.shadow) : 'soft'
  const scene = normalize(raw.sceneImageUrl)
  return {
    background: color(raw.background, '#f4f8fc'),
    foreground: color(raw.foreground, '#14263a'),
    muted: color(raw.muted, '#607286'),
    primary: color(raw.primary, '#2b8c8f'),
    primaryText: color(raw.primaryText, '#ffffff'),
    accent: color(raw.accent, '#2b8c8f'),
    card: color(raw.card, '#ffffff'),
    border: color(raw.border, '#d7e1eb'),
    radius,
    cardOpacity: opacity,
    shadow,
    backgroundMode: mode,
    gradientEnd: color(raw.gradientEnd, '#dcecf8'),
    sceneImageUrl: scene.startsWith('data:image/') || /^https?:\/\//i.test(scene) ? scene : ''
  }
}

async function listThemes(service: any) {
  const { data, error } = await service.from('dock_themes').select('*').order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error
    return NextResponse.json({ ok: true, themes: await listThemes(auth.service) })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not load themes.' }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error
    const body = await request.json()
    const action = normalize(body?.action) === 'publish' ? 'publish' : 'save'
    const id = normalize(body?.id)
    const name = normalize(body?.name) || 'Dock Theme'
    const slug = normalizeThemeSlug(body?.slug || name)
    const organizationId = normalize(body?.organizationId) || null
    const definition = normalizeDefinition(body?.definition)
    const now = new Date().toISOString()

    let theme: any = null
    if (id) {
      const { data: existing, error: existingError } = await auth.service.from('dock_themes').select('*').eq('id', id).single()
      if (existingError) throw existingError
      const nextVersion = Math.max(1, Number(existing.version) || 1) + 1
      const { data, error } = await auth.service.from('dock_themes').update({
        name, slug, organization_id: organizationId, scope: organizationId ? 'district' : 'global',
        status: action === 'publish' ? 'published' : 'draft', definition, version: nextVersion,
        updated_at: now, published_at: action === 'publish' ? now : existing.published_at
      }).eq('id', id).select('*').single()
      if (error) throw error
      theme = data
      await auth.service.from('dock_theme_versions').insert({ theme_id: id, version: nextVersion, definition, name, created_by: auth.ownerEmail }).throwOnError()
    } else {
      const { data, error } = await auth.service.from('dock_themes').insert({
        name, slug, organization_id: organizationId, scope: organizationId ? 'district' : 'global',
        status: action === 'publish' ? 'published' : 'draft', definition, version: 1,
        created_by: auth.ownerEmail, updated_at: now, published_at: action === 'publish' ? now : null
      }).select('*').single()
      if (error) throw error
      theme = data
      await auth.service.from('dock_theme_versions').insert({ theme_id: theme.id, version: 1, definition, name, created_by: auth.ownerEmail }).throwOnError()
    }

    if (action === 'publish' && organizationId) {
      await auth.service.from('organizations').update({ default_theme: slug, updated_at: now }).eq('id', organizationId).throwOnError()
    }

    await auth.service.from('audit_logs').insert({
      organization_id: organizationId,
      action: action === 'publish' ? 'owner_publish_theme' : 'owner_save_theme',
      target_type: 'dock_theme', target_id: theme.id,
      details: { name, slug, version: theme.version, scope: organizationId ? 'district' : 'global' }
    }).throwOnError()

    return NextResponse.json({ ok: true, theme, themes: await listThemes(auth.service) })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not save theme.' }, { status: 400 })
  }
}
