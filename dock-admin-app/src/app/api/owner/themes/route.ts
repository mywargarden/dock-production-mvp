export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { normalize, normalizeThemeSlug, requireOwner } from '@/lib/ownerServer'

const HEX = /^#[0-9a-f]{6}$/i

function cleanDefinition(raw: any) {
  const color = (value: any, fallback: string) => HEX.test(normalize(value)) ? normalize(value) : fallback
  const radius = Math.min(28, Math.max(4, Number(raw?.radius) || 16))
  const cardOpacity = Math.min(1, Math.max(.45, Number(raw?.cardOpacity) || .88))
  const sceneImageUrl = normalize(raw?.sceneImageUrl)
  return {
    background: color(raw?.background, '#f4f8fc'),
    foreground: color(raw?.foreground, '#14263a'),
    muted: color(raw?.muted, '#607286'),
    primary: color(raw?.primary, '#2b8c8f'),
    primaryText: color(raw?.primaryText, '#ffffff'),
    card: color(raw?.card, '#ffffff'),
    border: color(raw?.border, '#d7e1eb'),
    accent: color(raw?.accent, color(raw?.primary, '#2b8c8f')),
    radius,
    cardOpacity,
    shadow: ['none','soft','medium','deep'].includes(normalize(raw?.shadow)) ? normalize(raw?.shadow) : 'soft',
    backgroundMode: ['color','gradient','image'].includes(normalize(raw?.backgroundMode)) ? normalize(raw?.backgroundMode) : 'color',
    gradientEnd: color(raw?.gradientEnd, '#dcecf8'),
    sceneImageUrl: sceneImageUrl.startsWith('data:image/') || /^https?:\/\//i.test(sceneImageUrl) ? sceneImageUrl : ''
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
    const action = normalize(body?.action || 'save')
    const id = normalize(body?.id)

    if (action === 'archive') {
      if (!id) throw new Error('Theme id is required.')
      const { error } = await auth.service.from('dock_themes').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true, themes: await listThemes(auth.service) })
    }

    const name = normalize(body?.name)
    if (!name) throw new Error('Theme name is required.')
    const slug = normalizeThemeSlug(body?.slug || name)
    const organizationId = normalize(body?.organizationId) || null
    const definition = cleanDefinition(body?.definition)
    const status = action === 'publish' ? 'published' : 'draft'
    const now = new Date().toISOString()

    let theme: any = null
    if (id) {
      const { data: existing, error: getError } = await auth.service.from('dock_themes').select('*').eq('id', id).single()
      if (getError) throw getError
      const nextVersion = Math.max(1, Number(existing.version) || 1) + (action === 'publish' ? 1 : 0)
      const { data, error } = await auth.service.from('dock_themes').update({
        name, slug, organization_id: organizationId, scope: organizationId ? 'district' : 'global', definition,
        status, version: nextVersion, updated_at: now, published_at: action === 'publish' ? now : existing.published_at
      }).eq('id', id).select('*').single()
      if (error) throw error
      theme = data
    } else {
      const { data, error } = await auth.service.from('dock_themes').insert({
        name, slug, organization_id: organizationId, scope: organizationId ? 'district' : 'global', definition,
        status, version: 1, created_by: auth.ownerEmail, published_at: action === 'publish' ? now : null
      }).select('*').single()
      if (error) throw error
      theme = data
    }

    if (action === 'publish') {
      await auth.service.from('dock_theme_versions').upsert({
        theme_id: theme.id, version: theme.version, definition: theme.definition, name: theme.name, created_by: auth.ownerEmail
      }, { onConflict: 'theme_id,version' }).throwOnError()
      if (organizationId) {
        await auth.service.from('organizations').update({ default_theme: theme.slug, updated_at: now }).eq('id', organizationId).throwOnError()
      }
    }

    await auth.service.from('audit_logs').insert({
      organization_id: organizationId,
      action: action === 'publish' ? 'owner_publish_theme' : 'owner_save_theme',
      target_type: 'dock_theme', target_id: theme.id,
      details: { name: theme.name, slug: theme.slug, version: theme.version, status: theme.status }
    }).throwOnError()

    return NextResponse.json({ ok: true, theme, themes: await listThemes(auth.service) })
  } catch (error: any) {
    console.error('Dock HQ theme save failed', error)
    return NextResponse.json({ error: error?.message || 'Could not save theme.' }, { status: 400 })
  }
}
