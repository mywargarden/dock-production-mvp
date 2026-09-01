export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOwnerDistricts, normalize, requireOwner } from '@/lib/ownerServer'

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error
    const body = await request.json()
    const organizationId = normalize(body?.organizationId)
    const userId = normalize(body?.userId)
    const requested = normalize(body?.status).toLowerCase()
    const status = requested === 'inactive' || requested === 'disabled' ? 'disabled' : 'active'
    if (!organizationId || !userId) return NextResponse.json({ error: 'organizationId and userId are required.' }, { status: 400 })

    const { data: profile, error } = await auth.service.rpc('dock_owner_set_profile_status', {
      p_organization_id: organizationId,
      p_user_id: userId,
      p_status: status,
      p_actor_email: auth.ownerEmail,
    })
    if (error) throw error

    return NextResponse.json({ ok: true, profile, districts: await loadOwnerDistricts(auth.service) })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not update user.' }, { status: 400 })
  }
}
