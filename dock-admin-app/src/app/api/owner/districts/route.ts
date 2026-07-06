export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOwnerDistricts, persistOwnerDistrict, requireOwner, validateOwnerDistrictPayload } from '@/lib/ownerServer'

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
    const org = await persistOwnerDistrict(auth.service, payload)
    const districts = await loadOwnerDistricts(auth.service)
    return NextResponse.json({ ok: true, organization: org, districts })
  } catch (error: any) {
    console.error('Dock HQ save district failed', error)
    return NextResponse.json({ error: error?.message || 'Could not save district.' }, { status: 400 })
  }
}
