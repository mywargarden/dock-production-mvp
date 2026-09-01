export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { materializeManagedImage } from '@/lib/managedAssets'
import { normalize, requireOwner } from '@/lib/ownerServer'

function hasInline(value: unknown) { return normalize(value).startsWith('data:image/') }

async function materializeTabs(service: any, orgCode: string, tabs: any[]) {
  const next = []
  let changed = 0
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index] || {}
    if (hasInline(tab.icon_url)) {
      const iconUrl = await materializeManagedImage(service, tab.icon_url, { orgCode, kind: `tab-icon-${tab.position ?? index}` })
      next.push({ ...tab, icon_url: iconUrl || null })
      changed += 1
    } else next.push(tab)
  }
  return { tabs: next, changed }
}

async function materializeBranding(service: any, orgCode: string, source: any) {
  const branding = source && typeof source === 'object' ? { ...source } : {}
  let changed = 0
  if (hasInline(branding.district_logo_url)) {
    branding.district_logo_url = await materializeManagedImage(service, branding.district_logo_url, { orgCode, kind: 'logo' }) || null
    changed += 1
  }
  if (hasInline(branding.district_background_url)) {
    branding.district_background_url = await materializeManagedImage(service, branding.district_background_url, { orgCode, kind: 'background' }) || null
    changed += 1
  }
  return { branding, changed }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error

    const body = await request.json().catch(() => ({}))
    const organizationId = normalize(body?.organizationId)
    const orgCodeHint = normalize(body?.orgCode)
    if (!organizationId && !orgCodeHint) return NextResponse.json({ error: 'organizationId or orgCode is required.' }, { status: 400 })

    let orgQuery = auth.service.from('organizations').select('*')
    orgQuery = organizationId ? orgQuery.eq('id', organizationId) : orgQuery.eq('org_code', orgCodeHint)
    const { data: org, error: orgError } = await orgQuery.maybeSingle()
    if (orgError) throw orgError
    if (!org?.id || !org?.org_code) return NextResponse.json({ error: 'District not found.' }, { status: 404 })

    const orgCode = normalize(org.org_code)
    const counts = { branding: 0, draftBranding: 0, draftTabs: 0, liveTabs: 0, snapshots: 0, snapshotTabs: 0, snapshotBranding: 0 }

    let liveLogo = normalize(org.district_logo_url)
    let liveBackground = normalize(org.district_background_url)
    if (hasInline(liveLogo)) {
      liveLogo = await materializeManagedImage(auth.service, liveLogo, { orgCode, kind: 'logo' }) || ''
      counts.branding += 1
    }
    if (hasInline(liveBackground)) {
      liveBackground = await materializeManagedImage(auth.service, liveBackground, { orgCode, kind: 'background' }) || ''
      counts.branding += 1
    }

    const draftBranding = await materializeBranding(auth.service, orgCode, org.draft_branding)
    counts.draftBranding = draftBranding.changed

    const draft = await materializeTabs(auth.service, orgCode, Array.isArray(org.draft_tabs) ? org.draft_tabs : [])
    counts.draftTabs = draft.changed

    const { data: workspaces, error: workspaceError } = await auth.service.from('workspaces').select('id').eq('organization_id', org.id)
    if (workspaceError) throw workspaceError
    const workspaceIds = (workspaces || []).map((row: any) => row.id).filter(Boolean)
    const liveTabRefs: any[] = []
    if (workspaceIds.length) {
      const { data: liveTabs, error: liveError } = await auth.service
        .from('workspace_tabs')
        .select('id,workspace_id,icon_url,position')
        .in('workspace_id', workspaceIds)
        .order('position', { ascending: true })
      if (liveError) throw liveError
      for (let index = 0; index < (liveTabs || []).length; index += 1) {
        const tab = (liveTabs || [])[index]
        if (!hasInline(tab?.icon_url)) continue
        const iconUrl = await materializeManagedImage(auth.service, tab.icon_url, { orgCode, kind: `tab-icon-${tab.position ?? index}` })
        liveTabRefs.push({ id: tab.id, icon_url: iconUrl || null })
        counts.liveTabs += 1
      }
    }

    const { data: versions, error: versionsError } = await auth.service
      .from('workspace_versions')
      .select('id,tabs,branding')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: true })
    if (versionsError) throw versionsError

    const versionRefs: any[] = []
    for (const version of versions || []) {
      const snapBranding = await materializeBranding(auth.service, orgCode, version.branding)
      const snapTabs = Array.isArray(version.tabs) ? version.tabs : []
      const materialized = await materializeTabs(auth.service, orgCode, snapTabs)
      counts.snapshotBranding += snapBranding.changed
      counts.snapshotTabs += materialized.changed
      if (snapBranding.changed || materialized.changed) {
        versionRefs.push({ id: version.id, tabs: materialized.tabs, branding: snapBranding.branding })
        counts.snapshots += 1
      }
    }

    const { data: applied, error: applyError } = await auth.service.rpc('dock_owner_apply_complete_managed_asset_refs', {
      p_organization_id: org.id,
      p_live_logo_url: liveLogo || null,
      p_live_background_url: liveBackground || null,
      p_draft_branding: draftBranding.branding,
      p_draft_tabs: draft.tabs,
      p_live_tabs: liveTabRefs,
      p_versions: versionRefs,
      p_actor_email: auth.ownerEmail,
    })
    if (applyError) throw applyError

    return NextResponse.json({ ok: true, organizationId: org.id, orgCode, counts, applied })
  } catch (error: any) {
    console.error('Dock managed asset materialization failed', error)
    return NextResponse.json({ error: error?.message || 'Managed asset materialization failed.' }, { status: 400 })
  }
}
