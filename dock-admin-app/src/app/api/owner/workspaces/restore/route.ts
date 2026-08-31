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
      districts: await loadOwnerDistricts(auth.service),
    })
  } catch (error: any) {
    console.error('Dock HQ workspace restore failed', error)
    return NextResponse.json({ error: error?.message || 'Workspace restore failed.' }, { status: 400 })
  }
}
