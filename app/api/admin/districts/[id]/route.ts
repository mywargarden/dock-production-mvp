import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/adminAuth';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { id } = await context.params;
  const { data, error } = await supabaseAdmin
    .from('dock_districts')
    .select('*, dock_licenses(*), dock_district_domains(*), dock_license_users(*)')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ district: data });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { id } = await context.params;
  const body = await request.json();

  const districtPatch: Record<string, unknown> = {};
  if ('name' in body) districtPatch.name = body.name;
  if ('contactName' in body) districtPatch.contact_name = body.contactName || null;
  if ('contactEmail' in body) districtPatch.contact_email = body.contactEmail || null;
  if ('notes' in body) districtPatch.notes = body.notes || null;

  let district = null;
  if (Object.keys(districtPatch).length) {
    const result = await supabaseAdmin
      .from('dock_districts')
      .update(districtPatch)
      .eq('id', id)
      .select('*')
      .single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    district = result.data;
  }

  if ('licenseStatus' in body || 'maxUsers' in body || 'expiresAt' in body || 'graceUntil' in body) {
    const licensePatch: Record<string, unknown> = {};
    if ('licenseStatus' in body) licensePatch.status = body.licenseStatus;
    if ('maxUsers' in body) licensePatch.max_users = Number(body.maxUsers || 0);
    if ('expiresAt' in body) licensePatch.expires_at = body.expiresAt || null;
    if ('graceUntil' in body) licensePatch.grace_until = body.graceUntil || null;

    const result = await supabaseAdmin
      .from('dock_licenses')
      .update(licensePatch)
      .eq('district_id', id)
      .select('*')
      .single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  await supabaseAdmin.from('dock_license_audit_events').insert({
    district_id: id,
    actor: 'admin',
    event_type: 'district_updated',
    payload: body,
  });

  return NextResponse.json({ ok: true, district });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { id } = await context.params;
  const { error } = await supabaseAdmin.from('dock_districts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
