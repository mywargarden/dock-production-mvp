import type { SupabaseClient } from '@supabase/supabase-js'

export type AccessDecision =
  | {
      ok: true
      reason: 'domain' | 'allowlist' | 'existing-profile'
      organizationId: string
      organization: any
      profile: any
      activeSeatCount: number
      maxUsers: number
    }
  | {
      ok: false
      code:
        | 'NO_ORGANIZATION'
        | 'EMAIL_NOT_ALLOWED'
        | 'PROFILE_DISABLED'
        | 'SEAT_LIMIT_REACHED'
        | 'PROFILE_ERROR'
      reason: string
      status: number
      details?: Record<string, unknown>
    }

function normalize(value: unknown): string {
  return String(value || '').trim()
}

function normalizeEmail(value: unknown): string {
  return normalize(value).toLowerCase()
}

function emailDomain(email: string): string {
  const parts = email.split('@')
  return parts.length === 2 ? parts[1].toLowerCase() : ''
}

export async function resolveLicensedAccess(params: {
  supabase: SupabaseClient
  userId: string
  email: string
  org: any | null
  domainRecord?: any | null
}): Promise<AccessDecision> {
  const { supabase, userId } = params
  const normalizedEmail = normalizeEmail(params.email)
  const domain = emailDomain(normalizedEmail)
  const org = params.org

  if (!userId || !normalizedEmail || !org?.id) {
    return {
      ok: false,
      code: 'NO_ORGANIZATION',
      reason: 'Missing user, email, or organization.',
      status: 403,
    }
  }

  const maxUsers = Number(org.max_users) || 0

  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('profiles')
    .select('id, email, organization_id, role, status')
    .eq('id', userId)
    .maybeSingle()

  if (existingProfileError) {
    return {
      ok: false,
      code: 'PROFILE_ERROR',
      reason: existingProfileError.message,
      status: 500,
      details: { phase: 'select-existing-profile' },
    }
  }

  if (existingProfile?.status === 'disabled') {
    return {
      ok: false,
      code: 'PROFILE_DISABLED',
      reason: 'This user profile is disabled.',
      status: 403,
    }
  }

  const existingProfileMatchesOrg =
    existingProfile?.id &&
    existingProfile.organization_id === org.id &&
    normalizeEmail(existingProfile.email) === normalizedEmail

  if (!existingProfileMatchesOrg) {
    const { data: allowedEmail, error: allowedEmailError } = await supabase
      .from('organization_allowed_emails')
      .select('id, role, status')
      .eq('organization_id', org.id)
      .eq('normalized_email', normalizedEmail)
      .eq('status', 'active')
      .maybeSingle()

    if (allowedEmailError) {
      return {
        ok: false,
        code: 'PROFILE_ERROR',
        reason: allowedEmailError.message,
        status: 500,
        details: { phase: 'select-allowed-email' },
      }
    }

    const domainAllowed = Boolean(params.domainRecord)

    if (!domainAllowed && !allowedEmail?.id) {
      return {
        ok: false,
        code: 'EMAIL_NOT_ALLOWED',
        reason: 'Email is not allowed for this organization.',
        status: 403,
        details: { emailDomain: domain },
      }
    }

    if (maxUsers > 0) {
      const { count, error: countError } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', org.id)
        .eq('status', 'active')

      if (countError) {
        return {
          ok: false,
          code: 'PROFILE_ERROR',
          reason: countError.message,
          status: 500,
          details: { phase: 'count-active-seats' },
        }
      }

      const activeSeatCount = count || 0
      if (!existingProfile?.id && activeSeatCount >= maxUsers) {
        return {
          ok: false,
          code: 'SEAT_LIMIT_REACHED',
          reason: 'Organization license limit reached.',
          status: 403,
          details: { activeSeatCount, maxUsers },
        }
      }
    }
  }

  const role = existingProfile?.role || 'member'

  const { data: profile, error: upsertError } = await supabase
    .from('profiles')
    .upsert(
      {
        id: userId,
        email: normalizedEmail,
        organization_id: org.id,
        role,
        status: 'active',
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    .select('id, email, organization_id, role, status, last_seen_at')
    .maybeSingle()

  if (upsertError) {
    return {
      ok: false,
      code: 'PROFILE_ERROR',
      reason: upsertError.message,
      status: 500,
      details: { phase: 'upsert-profile' },
    }
  }

  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)
    .eq('status', 'active')

  return {
    ok: true,
    reason: existingProfileMatchesOrg
      ? 'existing-profile'
      : params.domainRecord
        ? 'domain'
        : 'allowlist',
    organizationId: org.id,
    organization: org,
    profile,
    activeSeatCount: count || 0,
    maxUsers,
  }
}
