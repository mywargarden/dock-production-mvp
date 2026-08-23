import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../../../lib/adminAuth';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { id } = await context.params;
  const body = await request.json();
  const patch: Record<string, unknown> = {};

  if ('name' in body) patch.name = body.name || null;
  if ('role' in body) patch.role = body.role || 'teacher';
  if ('status' in body) patch.status = body.status || 'active';

  const { data, error } = await supabaseAdmin
    .from('dock_license_users')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('dock_license_audit_events').insert({
    district_id: data.district_id,
    license_id: data.license_id,
    actor: 'admin',
    event_type: 'user_updated',
    payload: { userId: id, patch },
  });

  return NextResponse.json({ user: data });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { id } = await context.params;
  const { data, error: readError } = await supabaseAdmin
    .from('dock_license_users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const { error } = await supabaseAdmin.from('dock_license_users').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (data) {
    await supabaseAdmin.from('dock_license_audit_events').insert({
      district_id: data.district_id,
      license_id: data.license_id,
      actor: 'admin',
      event_type: 'user_deleted',
      payload: { userId: id, email: data.email },
    });
  }

  return NextResponse.json({ ok: true });
}
