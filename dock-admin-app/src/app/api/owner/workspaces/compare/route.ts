export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { normalize, requireOwner } from '@/lib/ownerServer'

function tabKey(tab: any) {
  return `${normalize(tab?.title).toLowerCase()}|${normalize(tab?.url).toLowerCase()}`
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error

    const organizationId = normalize(request.nextUrl.searchParams.get('organizationId'))
    const snapshotId = normalize(request.nextUrl.searchParams.get('snapshotId'))
    if (!organizationId || !snapshotId) {
      return NextResponse.json({ error: 'organizationId and snapshotId are required.' }, { status: 400 })
    }

    const [{ data: org, error: orgError }, { data: target, error: targetError }, { data: live, error: liveError }] = await Promise.all([
      auth.service.from('organizations').select('*').eq('id', organizationId).maybeSingle(),
      auth.service.from('workspace_versions').select('*').eq('id', snapshotId).eq('organization_id', organizationId).maybeSingle(),
      auth.service.from('workspaces').select('*').eq('organization_id', organizationId).eq('status', 'published').order('published_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (orgError) throw orgError
    if (targetError) throw targetError
    if (liveError) throw liveError
    if (!org || !target || !live) return NextResponse.json({ error: 'Could not resolve the district, live workspace, and requested snapshot.' }, { status: 404 })

    const { data: currentTabs, error: tabsError } = await auth.service
      .from('workspace_tabs')
      .select('id,title,url,icon_url,position,is_locked')
      .eq('workspace_id', live.id)
      .order('position', { ascending: true })
    if (tabsError) throw tabsError

    const liveTabs = currentTabs || []
    const snapshotTabs = Array.isArray(target.tabs) ? target.tabs : []
    const liveKeys = new Set(liveTabs.map(tabKey))
    const snapshotKeys = new Set(snapshotTabs.map(tabKey))
    const added = snapshotTabs.filter((tab: any) => !liveKeys.has(tabKey(tab)))
    const removed = liveTabs.filter((tab: any) => !snapshotKeys.has(tabKey(tab)))
    const branding = target.branding && typeof target.branding === 'object' ? target.branding : {}
    const brandingFields = ['district_logo_url','district_background_url','district_accent_color','district_primary_color','district_secondary_color','default_theme']
    const brandingChanges = brandingFields.flatMap(key => {
      if (!Object.prototype.hasOwnProperty.call(branding, key)) return []
      const before = org[key] ?? null
      const after = branding[key] ?? null
      return before === after ? [] : [{ key, before, after }]
    })

    return NextResponse.json({
      ok: true,
      comparison: {
        organizationId,
        district: org.name,
        live: {
          workspaceId: live.id,
          name: live.name,
          version: Number(live.version) || 1,
          publishedAt: live.published_at || null,
          resourceCount: liveTabs.length,
        },
        snapshot: {
          id: target.id,
          name: target.name,
          version: Number(target.version) || 0,
          publishedAt: target.published_at || target.created_at || null,
          resourceCount: snapshotTabs.length,
        },
        workspaceNameChanged: normalize(live.name) !== normalize(target.name),
        resources: {
          added,
          removed,
          unchangedCount: snapshotTabs.filter((tab: any) => liveKeys.has(tabKey(tab))).length,
        },
        brandingChanges,
        changeCount: added.length + removed.length + brandingChanges.length + (normalize(live.name) !== normalize(target.name) ? 1 : 0),
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Workspace comparison failed.' }, { status: 400 })
  }
}
