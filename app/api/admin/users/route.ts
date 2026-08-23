import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/adminAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { normalizeEmail } from '../../../../lib/license';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const districtId = request.nextUrl.searchParams.get('districtId');
  let query = supabaseAdmin
    .from('dock_license_users')
    .select('*, dock_districts(name, district_id), dock_licenses(status, plan, max_users)')
    .order('created_at', { ascending: false });

  if (districtId) query = query.eq('district_id', districtId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const body = await request.json();
  const email = normalizeEmail(body.email);
  const districtId = String(body.districtId || '');

  if (!email || !districtId) {
    return NextResponse.json({ error: 'email and districtId are required' }, { status: 400 });
  }

  const { data: license, error: licenseError } = await supabaseAdmin
    .from('dock_licenses')
    .select('*')
    .eq('district_id', districtId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (licenseError) return NextResponse.json({ error: licenseError.message }, { status: 500 });

  const { data, error } = await supabaseAdmin
    .from('dock_license_users')
    .upsert(
      {
        district_id: districtId,
        license_id: license.id,
        email,
        name: body.name || null,
        role: body.role || 'teacher',
        status: body.status || 'active',
      },
      { onConflict: 'license_id,email' }
    )
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('dock_license_audit_events').insert({
    district_id: districtId,
    license_id: license.id,
    actor: 'admin',
    event_type: 'user_upserted',
    payload: { email, name: body.name || null, role: body.role || 'teacher' },
  });

  return NextResponse.json({ user: data });
}
