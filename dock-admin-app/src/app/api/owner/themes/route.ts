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
    return NextResponse.json({ ok: true, themes: await listThemes(auth.service), versions: themeId ? await listVersions(auth.service, themeId) : [] })
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

    if (['archive', 'restore'].includes(action)) {
      if (!id) return NextResponse.json({ error: 'Theme id is required.' }, { status: 400 })
      const { data: theme, error } = await auth.service.rpc('dock_owner_set_theme_status', {
        p_theme_id: id,
        p_action: action,
        p_actor_email: auth.ownerEmail,
      })
      if (error) throw error
      return NextResponse.json({ ok: true, theme, themes: await listThemes(auth.service), versions: await listVersions(auth.service, id) })
    }

    if (!['save', 'publish'].includes(action)) {
      return NextResponse.json({ error: 'Unsupported theme action.' }, { status: 400 })
    }

    const name = normalize(body?.name) || 'Dock Theme'
    const slug = normalizeThemeSlug(body?.slug || name)
    const organizationId = normalize(body?.organizationId) || null
    const definition = normalizeDefinition(body?.definition)

    const { data: theme, error } = await auth.service.rpc('dock_owner_save_theme', {
      p_theme_id: id || null,
      p_name: name,
      p_slug: slug,
      p_organization_id: organizationId,
      p_definition: definition,
      p_action: action,
      p_actor_email: auth.ownerEmail,
    })
    if (error) throw error

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
