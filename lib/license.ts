import { supabaseAdmin } from './supabaseAdmin';

export type DockLicenseStatus =
  | 'active'
  | 'trial'
  | 'grace'
  | 'past_due'
  | 'suspended'
  | 'inactive'
  | 'expired'
  | 'canceled'
  | 'disabled'
  | 'terminated';

export function normalizeEmail(email?: string | null) {
  return (email || '').trim().toLowerCase();
}

export function emailDomain(email?: string | null) {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at < 0) return '';
  return normalized.slice(at + 1);
}

export function licenseStatusFromStripe(subscriptionStatus?: string | null): DockLicenseStatus {
  switch ((subscriptionStatus || '').toLowerCase()) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trial';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
    case 'paused':
      return 'suspended';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'incomplete':
      return 'inactive';
    default:
      return 'inactive';
  }
}

export async function getDistrictLicenseForEmail(email: string) {
  const domain = emailDomain(email);
  if (!domain) return null;

  const { data: domainRow, error: domainError } = await supabaseAdmin
    .from('dock_district_domains')
    .select('district_id, auto_assign')
    .eq('domain', domain)
    .maybeSingle();

  if (domainError || !domainRow) return null;

  const { data: district, error: districtError } = await supabaseAdmin
    .from('dock_districts')
    .select('*')
    .eq('id', domainRow.district_id)
    .maybeSingle();

  if (districtError || !district) return null;

  const { data: license, error: licenseError } = await supabaseAdmin
    .from('dock_licenses')
    .select('*')
    .eq('district_id', district.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (licenseError || !license) return null;

  if (domainRow.auto_assign) {
    await upsertLicenseUser({
      districtId: district.id,
      licenseId: license.id,
      email,
      role: 'teacher',
    });
  }

  return { district, license };
}

export async function upsertLicenseUser(input: {
  districtId: string;
  licenseId: string;
  email: string;
  name?: string | null;
  role?: string;
}) {
  const email = normalizeEmail(input.email);
  if (!email) return null;

  const { data, error } = await supabaseAdmin
    .from('dock_license_users')
    .upsert(
      {
        district_id: input.districtId,
        license_id: input.licenseId,
        email,
        name: input.name || null,
        role: input.role || 'teacher',
        status: 'active',
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'license_id,email' }
    )
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function buildExtensionConfigForEmail(email: string) {
  const found = await getDistrictLicenseForEmail(email);
  if (!found) {
    return {
      ok: false,
      reason: 'no_matching_district_license',
      license: { status: 'inactive' },
    };
  }

  const { district, license } = found;

  return {
    ok: true,
    districtId: district.district_id,
    districtName: district.name,
    apiBaseUrl: district.api_base_url,
    allowPersonalDocks: true,
    allowSharing: true,
    managedMode: true,
    license: {
      plan: license.plan,
      status: license.status,
      expiresAt: license.expires_at,
      graceUntil: license.grace_until,
      maxUsers: license.max_users,
      minExtensionVersion: license.min_extension_version,
    },
  };
}
