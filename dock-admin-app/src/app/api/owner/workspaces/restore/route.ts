export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOwnerDistricts, normalize, requireOwner } from '@/lib/ownerServer'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error

    const body = await request.json()
    const organizationId = normalize(body?.organizationId)
    const snapshotId = normalize(body?.snapshotId)
    const reason = normalize(body?.reason)

    if (!organizationId || !snapshotId) {
      return NextResponse.json({ error: 'organizationId and snapshotId are required.' }, { status: 400 })
    }
    if (reason.length < 5) {
      return NextResponse.json({ error: 'A restore reason of at least 5 characters is required.' }, { status: 400 })
    }

    const { data: org, error: orgError } = await auth.service
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .maybeSingle()
    if (orgError) throw orgError
    if (!org) return NextResponse.json({ error: 'District not found.' }, { status: 404 })

    const { data: target, error: targetError } = await auth.service
      .from('workspace_versions')
      .select('*')
      .eq('id', snapshotId)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (targetError) throw targetError
    if (!target) return NextResponse.json({ error: 'Workspace snapshot not found for this district.' }, { status: 404 })

    const { data: live, error: liveError } = await auth.service
      .from('workspaces')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (liveError) throw liveError
    if (!live) return NextResponse.json({ error: 'No published workspace exists to restore.' }, { status: 404 })

    const { data: currentTabs, error: tabsError } = await auth.service
      .from('workspace_tabs')
      .select('title,url,icon_url,position,is_locked')
      .eq('workspace_id', live.id)
      .order('position', { ascending: true })
    if (tabsError) throw tabsError

    const now = new Date().toISOString()
    const currentVersion = Math.max(1, Number(live.version) || 1)
    const nextVersion = currentVersion + 1
    const targetTabs = Array.isArray(target.tabs) ? target.tabs : []
    const targetBranding = target.branding && typeof target.branding === 'object' ? target.branding : {}

    await auth.service.from('workspace_versions').insert({
      organization_id: organizationId,
      workspace_id: live.id,
      version: currentVersion,
      name: live.name,
      tabs: currentTabs || [],
      branding: {
        district_logo_url: org.district_logo_url || null,
        district_background_url: org.district_background_url || null,
        district_accent_color: org.district_accent_color || null,
        district_primary_color: org.district_primary_color || null,
        district_secondary_color: org.district_secondary_color || null,
        default_theme: org.default_theme || null,
      },
      published_at: live.published_at || now,
      created_by: null,
    }).throwOnError()

    await auth.service.from('workspaces').update({
      name: target.name,
      version: nextVersion,
      status: 'published',
      is_locked: true,
      published_at: now,
      updated_at: now,
    }).eq('id', live.id).throwOnError()

    await auth.service.from('workspace_tabs').delete().eq('workspace_id', live.id).throwOnError()
    if (targetTabs.length) {
      await auth.service.from('workspace_tabs').insert(targetTabs.map((tab: any, index: number) => ({
        workspace_id: live.id,
        title: normalize(tab?.title) || `Resource ${index + 1}`,
        url: normalize(tab?.url),
        icon_url: normalize(tab?.icon_url) || null,
        position: index,
        is_locked: tab?.is_locked !== false,
        updated_at: now,
      })).filter((tab: any) => tab.url)).throwOnError()
    }

    const orgPatch: any = {
      draft_workspace_name: target.name,
      draft_tabs: targetTabs,
      published_at: now,
      updated_at: now,
    }
    for (const key of ['district_logo_url','district_background_url','district_accent_color','district_primary_color','district_secondary_color','default_theme']) {
      if (Object.prototype.hasOwnProperty.call(targetBranding, key)) orgPatch[key] = targetBranding[key]
    }
    await auth.service.from('organizations').update(orgPatch).eq('id', organizationId).throwOnError()

    await auth.service.from('audit_logs').insert({
      organization_id: organizationId,
      actor_email: auth.ownerEmail,
      action: 'owner_restore_workspace',
      target_type: 'workspace',
      target_id: live.id,
      details: {
        reason,
        restoredSnapshotId: target.id,
        restoredSnapshotVersion: target.version,
        previousLiveVersion: currentVersion,
        newLiveVersion: nextVersion,
        resourceCount: targetTabs.length,
      },
    }).throwOnError()

    return NextResponse.json({
      ok: true,
      restored: { snapshotId: target.id, snapshotVersion: target.version, liveVersion: nextVersion },
      districts: await loadOwnerDistricts(auth.service),
    })
  } catch (error: any) {
    console.error('Dock HQ workspace restore failed', error)
    return NextResponse.json({ error: error?.message || 'Workspace restore failed.' }, { status: 400 })
  }
}
