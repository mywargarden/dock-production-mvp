import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/adminAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { data, error } = await supabaseAdmin
    .from('dock_districts')
    .select('*, dock_licenses(*), dock_district_domains(*)')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ districts: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const body = await request.json();
  const districtId = String(body.districtId || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const domain = String(body.domain || '').trim().toLowerCase();
  const maxUsers = Number(body.maxUsers || 0);
  const status = String(body.status || 'trial');

  if (!districtId || !name) {
    return NextResponse.json({ error: 'districtId and name are required' }, { status: 400 });
  }

  const { data: district, error: districtError } = await supabaseAdmin
    .from('dock_districts')
    .insert({
      district_id: districtId,
      name,
      contact_name: body.contactName || null,
      contact_email: body.contactEmail || null,
      notes: body.notes || null,
    })
    .select('*')
    .single();

  if (districtError) return NextResponse.json({ error: districtError.message }, { status: 500 });

  const { data: license, error: licenseError } = await supabaseAdmin
    .from('dock_licenses')
    .insert({
      district_id: district.id,
      plan: body.plan || 'district',
      status,
      max_users: maxUsers,
      min_extension_version: body.minExtensionVersion || '0.3.3',
      expires_at: body.expiresAt || null,
      grace_until: body.graceUntil || null,
    })
    .select('*')
    .single();

  if (licenseError) return NextResponse.json({ error: licenseError.message }, { status: 500 });

  if (domain) {
    const { error: domainError } = await supabaseAdmin
      .from('dock_district_domains')
      .insert({ district_id: district.id, domain, auto_assign: true });
    if (domainError) return NextResponse.json({ error: domainError.message }, { status: 500 });
  }

  await supabaseAdmin.from('dock_license_audit_events').insert({
    district_id: district.id,
    license_id: license.id,
    actor: 'admin',
    event_type: 'district_created',
    payload: { districtId, name, domain, status, maxUsers },
  });

  return NextResponse.json({ district, license });
}
