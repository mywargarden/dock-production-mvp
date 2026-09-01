export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/ownerServer'
import { materializeManagedImage } from '@/lib/managedAssets'

function normalize(value: unknown) {
  return String(value || '').trim()
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error

    const body = await request.json().catch(() => ({}))
    const orgCode = normalize(body?.orgCode)
    if (!orgCode) return NextResponse.json({ error: 'orgCode is required.' }, { status: 400 })

    const { data: org, error: orgError } = await auth.service
      .from('organizations')
      .select('id,org_code,district_logo_url,district_background_url')
      .eq('org_code', orgCode)
      .maybeSingle()
    if (orgError) throw orgError
    if (!org?.id) return NextResponse.json({ error: 'District not found.' }, { status: 404 })

    const { data: workspace, error: workspaceError } = await auth.service
      .from('workspaces')
      .select('id')
      .eq('organization_id', org.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (workspaceError) throw workspaceError
    if (!workspace?.id) return NextResponse.json({ error: 'Published workspace not found.' }, { status: 404 })

    const { data: tabs, error: tabsError } = await auth.service
      .from('workspace_tabs')
      .select('title,url,icon_url,position,is_locked')
      .eq('workspace_id', workspace.id)
      .order('position', { ascending: true })
    if (tabsError) throw tabsError

    const logoUrl = await materializeManagedImage(auth.service, org.district_logo_url, {
      orgCode,
      kind: 'logo',
    })
    const backgroundUrl = await materializeManagedImage(auth.service, org.district_background_url, {
      orgCode,
      kind: 'background',
    })

    const materializedTabs = []
    for (const tab of tabs || []) {
      const iconUrl = await materializeManagedImage(auth.service, tab.icon_url, {
        orgCode,
        kind: `tab-icon-${Number(tab.position) || 0}`,
      })
      materializedTabs.push({ ...tab, icon_url: iconUrl || null })
    }

    const { data: result, error: applyError } = await auth.service.rpc('dock_owner_apply_managed_asset_refs', {
      p_organization_id: org.id,
      p_workspace_id: workspace.id,
      p_logo_url: logoUrl || null,
      p_background_url: backgroundUrl || null,
      p_tabs: materializedTabs,
      p_actor_email: auth.ownerEmail,
    })
    if (applyError) throw applyError

    return NextResponse.json({ ok: true, ...(result || {}) })
  } catch (error: any) {
    console.error('Dock managed asset materialization failed', error)
    return NextResponse.json({ error: error?.message || 'Managed asset materialization failed.' }, { status: 400 })
  }
}
