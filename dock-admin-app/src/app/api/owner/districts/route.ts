export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { cleanAdmins, cleanAllowedUsers, cleanDomains, loadOwnerDistricts, requireOwner, validateOwnerDistrictPayload } from '@/lib/ownerServer'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error
    const districts = await loadOwnerDistricts(auth.service)
    return NextResponse.json({ ok: true, districts })
  } catch (error: any) {
    console.error('Dock HQ load districts failed', error)
    return NextResponse.json({ error: error?.message || 'Could not load districts.' }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error

    const payload = validateOwnerDistrictPayload(await request.json())
    const organization = payload.organization
    const domains = cleanDomains(payload.domains || [], organization.email_domain || '')
    const admins = cleanAdmins(payload.admins || [])
    const allowedUsers = cleanAllowedUsers(payload.allowedUsers || [])

    const { data: org, error } = await auth.service.rpc('dock_owner_upsert_district', {
      p_organization: organization,
      p_domains: domains,
      p_admins: admins,
      p_allowed_users: allowedUsers,
      p_actor_email: auth.ownerEmail,
    })
    if (error) throw error

    const districts = await loadOwnerDistricts(auth.service)
    return NextResponse.json({ ok: true, organization: org, districts })
  } catch (error: any) {
    console.error('Dock HQ save district failed', error)
    return NextResponse.json({ error: error?.message || 'Could not save district.' }, { status: 400 })
  }
}
