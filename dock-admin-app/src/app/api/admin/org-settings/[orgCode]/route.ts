import { NextRequest, NextResponse } from 'next/server'
import { loadOrganizationSettings, requireAdmin } from '@/lib/adminServer'

export async function GET(
  request: NextRequest,
  { params }: { params: { orgCode: string } }
) {
  try {
    const orgCode = decodeURIComponent(params.orgCode || '').trim()
    if (!orgCode) {
      return NextResponse.json({ error: 'Missing organization code.' }, { status: 400 })
    }

    const auth = await requireAdmin(request, orgCode)
    if ('error' in auth) return auth.error

    const settings = await loadOrganizationSettings(auth.service, orgCode)
    if (!settings) {
      return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })
    }

    return NextResponse.json(settings, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Could not load organization settings.' },
      { status: 500 }
    )
  }
}
