export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { materializeManagedImage } from '@/lib/managedAssets'
import { normalize, requireOwner } from '@/lib/ownerServer'

function hasInline(value: unknown) { return normalize(value).startsWith('data:image/') }

async function materializeTabs(service: any, orgCode: string, tabs: any[]) {
  const next = []
  let changed = false
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index] || {}
    if (hasInline(tab.icon_url)) {
      const iconUrl = await materializeManagedImage(service, tab.icon_url, { orgCode, kind: `tab-icon-${index}` })
      next.push({ ...tab, icon_url: iconUrl || null })
      changed = true
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
    const orgPatch: Record<string, any> = {}

    if (hasInline(org.district_logo_url)) {
      orgPatch.district_logo_url = await materializeManagedImage(auth.service, org.district_logo_url, { orgCode, kind: 'logo' }) || null
      counts.branding += 1
    }
    if (hasInline(org.district_background_url)) {
      orgPatch.district_background_url = await materializeManagedImage(auth.service, org.district_background_url, { orgCode, kind: 'background' }) || null
      counts.branding += 1
    }

    const draftBranding = await materializeBranding(auth.service, orgCode, org.draft_branding)
    if (draftBranding.changed) {
      orgPatch.draft_branding = draftBranding.branding
      counts.draftBranding = draftBranding.changed
    }

    const draft = await materializeTabs(auth.service, orgCode, Array.isArray(org.draft_tabs) ? org.draft_tabs : [])
    if (draft.changed) {
      orgPatch.draft_tabs = draft.tabs
      counts.draftTabs = draft.tabs.filter((tab: any, index: number) => normalize(tab?.icon_url) !== normalize((org.draft_tabs || [])[index]?.icon_url)).length
    }

    if (Object.keys(orgPatch).length) {
      const { error } = await auth.service.from('organizations').update({ ...orgPatch, updated_at: new Date().toISOString() }).eq('id', org.id)
      if (error) throw error
    }

    const { data: workspaces, error: workspaceError } = await auth.service.from('workspaces').select('id').eq('organization_id', org.id)
    if (workspaceError) throw workspaceError
    const workspaceIds = (workspaces || []).map((row: any) => row.id).filter(Boolean)
    if (workspaceIds.length) {
      const { data: liveTabs, error: liveError } = await auth.service.from('workspace_tabs').select('id,workspace_id,icon_url,position').in('workspace_id', workspaceIds).order('position', { ascending: true })
      if (liveError) throw liveError
      for (let index = 0; index < (liveTabs || []).length; index += 1) {
        const tab = (liveTabs || [])[index]
        if (!hasInline(tab?.icon_url)) continue
        const iconUrl = await materializeManagedImage(auth.service, tab.icon_url, { orgCode, kind: `tab-icon-${tab.position ?? index}` })
        const { error } = await auth.service.from('workspace_tabs').update({ icon_url: iconUrl || null, updated_at: new Date().toISOString() }).eq('id', tab.id)
        if (error) throw error
        counts.liveTabs += 1
      }
    }

    const { data: versions, error: versionsError } = await auth.service.from('workspace_versions').select('id,tabs,branding').eq('organization_id', org.id).order('created_at', { ascending: true })
    if (versionsError) throw versionsError

    for (const version of versions || []) {
      let changed = false
      const snapBranding = await materializeBranding(auth.service, orgCode, version.branding)
      if (snapBranding.changed) { counts.snapshotBranding += snapBranding.changed; changed = true }
      const snapTabs = Array.isArray(version.tabs) ? version.tabs : []
      const materialized = await materializeTabs(auth.service, orgCode, snapTabs)
      if (materialized.changed) {
        counts.snapshotTabs += materialized.tabs.filter((tab: any, index: number) => normalize(tab?.icon_url) !== normalize(snapTabs[index]?.icon_url)).length
        changed = true
      }
      if (changed) {
        const { error } = await auth.service.from('workspace_versions').update({ tabs: materialized.tabs, branding: snapBranding.branding }).eq('id', version.id).eq('organization_id', org.id)
        if (error) throw error
        counts.snapshots += 1
      }
    }

    const { error: auditError } = await auth.service.from('audit_logs').insert({
      organization_id: org.id,
      actor_email: auth.ownerEmail,
      action: 'owner_materialize_managed_assets',
      target_type: 'organization',
      target_id: org.id,
      details: counts,
    })
    if (auditError) throw auditError

    return NextResponse.json({ ok: true, organizationId: org.id, orgCode, counts })
  } catch (error: any) {
    console.error('Dock managed asset materialization failed', error)
    return NextResponse.json({ error: error?.message || 'Managed asset materialization failed.' }, { status: 400 })
  }
}
