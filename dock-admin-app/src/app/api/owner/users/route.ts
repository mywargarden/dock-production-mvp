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
    const status = normalize(body?.status).toLowerCase() === 'inactive' ? 'inactive' : 'active'
    if (!organizationId || !userId) return NextResponse.json({ error: 'organizationId and userId are required.' }, { status: 400 })

    const { data: profile, error: profileError } = await auth.service.from('profiles').select('id,email,organization_id,status').eq('id',userId).eq('organization_id',organizationId).maybeSingle()
    if (profileError) throw profileError
    if (!profile) return NextResponse.json({ error: 'User profile not found for this district.' }, { status: 404 })

    const { error: updateError } = await auth.service.from('profiles').update({ status, updated_at: new Date().toISOString() }).eq('id',userId).eq('organization_id',organizationId)
    if (updateError) throw updateError

    await auth.service.from('audit_logs').insert({ organization_id: organizationId, action: status === 'inactive' ? 'owner_deactivate_user' : 'owner_activate_user', target_type: 'profile', target_id: userId, details: { email: profile.email || null, previousStatus: profile.status || null, nextStatus: status } }).throwOnError()
    return NextResponse.json({ ok: true, districts: await loadOwnerDistricts(auth.service) })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not update user.' }, { status: 400 })
  }
}
