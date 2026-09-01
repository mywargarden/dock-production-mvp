export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOwnerDistricts, normalize, requireOwner } from '@/lib/ownerServer'
import { materializeManagedImage } from '@/lib/managedAssets'

async function materializeLegacySnapshotAssets(service: any, organizationId: string, snapshotId: string, actorEmail: string) {
  const [{ data: org, error: orgError }, { data: snapshot, error: snapshotError }] = await Promise.all([
    service.from('organizations').select('org_code').eq('id', organizationId).maybeSingle(),
    service.from('workspace_versions').select('id,tabs,branding').eq('id', snapshotId).eq('organization_id', organizationId).maybeSingle(),
  ])
  if (orgError) throw orgError
  if (snapshotError) throw snapshotError
  if (!org?.org_code || !snapshot?.id) return { changed: false }

  const orgCode = normalize(org.org_code)
  const tabs = Array.isArray(snapshot.tabs) ? snapshot.tabs : []
  const branding = snapshot.branding && typeof snapshot.branding === 'object' ? { ...snapshot.branding } : {}
  let changed = false

  if (normalize(branding.district_logo_url).startsWith('data:image/')) {
    branding.district_logo_url = await materializeManagedImage(service, branding.district_logo_url, { orgCode, kind: 'logo' })
    changed = true
  }
  if (normalize(branding.district_background_url).startsWith('data:image/')) {
    branding.district_background_url = await materializeManagedImage(service, branding.district_background_url, { orgCode, kind: 'background' })
    changed = true
  }

  const nextTabs = []
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index] || {}
    const icon = normalize(tab.icon_url)
    if (icon.startsWith('data:image/')) {
      const iconUrl = await materializeManagedImage(service, icon, { orgCode, kind: `tab-icon-${index}` })
      nextTabs.push({ ...tab, icon_url: iconUrl || null })
      changed = true
    } else nextTabs.push(tab)
  }

  if (!changed) return { changed: false }

  const { data: normalized, error: normalizeError } = await service.rpc('dock_owner_normalize_restore_snapshot_assets', {
    p_organization_id: organizationId,
    p_snapshot_id: snapshotId,
    p_tabs: nextTabs,
    p_branding: branding,
    p_actor_email: actorEmail,
  })
  if (normalizeError) throw normalizeError

  return { changed: true, normalized }
}

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

    const legacyAssets = await materializeLegacySnapshotAssets(auth.service, organizationId, snapshotId, auth.ownerEmail)

    const { data: restored, error: restoreError } = await auth.service.rpc('dock_owner_restore_workspace', {
      p_organization_id: organizationId,
      p_snapshot_id: snapshotId,
      p_actor_email: auth.ownerEmail,
      p_reason: reason,
    })
    if (restoreError) throw restoreError

    return NextResponse.json({
      ok: true,
      restored: restored || null,
      legacyAssetsMaterialized: legacyAssets.changed,
      districts: await loadOwnerDistricts(auth.service),
    })
  } catch (error: any) {
    console.error('Dock HQ workspace restore failed', error)
    return NextResponse.json({ error: error?.message || 'Workspace restore failed.' }, { status: 400 })
  }
}
