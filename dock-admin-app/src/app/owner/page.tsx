'use client'

import { useEffect, useMemo, useState } from 'react'
import { getAccessToken, getUser, signIn, signOut } from '@/lib/auth'

type DomainRow = { domain: string; status: 'verified' | 'pending'; domain_type: 'primary' | 'additional' }
type AdminRow = { email: string; role: 'owner' | 'district_admin' }
type AllowedUserRow = { email: string; name?: string; note?: string; status: 'active' | 'inactive' }
type DistrictForm = {
  organization: {
    name: string
    org_code: string
    email_domain: string
    plan: string
    max_users: number
    license_status: 'trial' | 'active' | 'past_due' | 'suspended' | 'expired'
    license_renewal_date: string
    grace_period_days: number
    minimum_extension_version: string
    owner_notes: string
  }
  domains: DomainRow[]
  admins: AdminRow[]
  allowedUsers: AllowedUserRow[]
}

const blankDistrict: DistrictForm = {
  organization: {
    name: '',
    org_code: '',
    email_domain: '',
    plan: 'district',
    max_users: 500,
    license_status: 'trial',
    license_renewal_date: '',
    grace_period_days: 30,
    minimum_extension_version: '',
    owner_notes: ''
  },
  domains: [],
  admins: [],
  allowedUsers: []
}

function normalizeDomain(value: string) {
  return String(value || '').trim().toLowerCase().replace(/^@+/, '')
}

function slugify(value: string) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function inputDate(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function toForm(item: any): DistrictForm {
  const org = item?.organization || {}
  return {
    organization: {
      name: org.name || '',
      org_code: org.org_code || '',
      email_domain: org.email_domain || '',
      plan: org.plan || 'district',
      max_users: Number(org.max_users) || 500,
      license_status: org.license_status || 'trial',
      license_renewal_date: inputDate(org.license_renewal_date),
      grace_period_days: Number(org.grace_period_days) || 30,
      minimum_extension_version: org.minimum_extension_version || '',
      owner_notes: org.owner_notes || ''
    },
    domains: (item?.domains || []).map((d: any) => ({
      domain: d.domain || d.normalized_domain || '',
      status: d.status === 'pending' ? 'pending' : 'verified',
      domain_type: d.domain_type === 'primary' ? 'primary' : 'additional'
    })),
    admins: (item?.admins || []).map((a: any) => ({
      email: a.email || '',
      role: a.role === 'owner' ? 'owner' : 'district_admin'
    })),
    allowedUsers: (item?.allowedUsers || []).map((u: any) => ({
      email: u.email || '',
      name: u.name || '',
      note: u.note || '',
      status: u.status === 'inactive' ? 'inactive' : 'active'
    }))
  }
}

export default function OwnerPage() {
  const [user, setUser] = useState<any>(null)
  const [districts, setDistricts] = useState<any[]>([])
  const [form, setForm] = useState<DistrictForm>(blankDistrict)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  const activeDistrict = useMemo(() => districts.find((d) => d.organization?.org_code === form.organization.org_code), [districts, form.organization.org_code])

  useEffect(() => {
    let active = true
    ;(async () => {
      const u = await getUser()
      if (!active) return
      setUser(u)
      if (u) loadDistricts()
    })()
    return () => { active = false }
  }, [])

  async function loadDistricts() {
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in to Dock HQ first.')
      setLoading(true)
      const response = await fetch('/api/owner/districts', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Could not load districts.')
      setDistricts(result.districts || [])
      setStatus(`Loaded ${result.districts?.length || 0} district profile(s).`)
    } catch (error: any) {
      setStatus(error?.message || 'Could not load Dock HQ.')
    } finally {
      setLoading(false)
    }
  }

  async function saveDistrict() {
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in to Dock HQ first.')
      setLoading(true)
      setStatus('Saving district license…')
      const response = await fetch('/api/owner/districts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form)
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Could not save district.')
      setDistricts(result.districts || [])
      setForm(toForm((result.districts || []).find((d: any) => d.organization?.org_code === result.organization?.org_code) || { organization: result.organization }))
      setStatus(`Saved ${result.organization?.name || 'district'}.`)
    } catch (error: any) {
      setStatus(error?.message || 'Save failed.')
    } finally {
      setLoading(false)
    }
  }

  function updateOrg(key: keyof DistrictForm['organization'], value: string | number) {
    setForm((current) => ({ ...current, organization: { ...current.organization, [key]: value } }))
  }

  function startNew() {
    setForm(blankDistrict)
    setStatus('Ready to create a new district license.')
  }

  function addDomain() {
    setForm((current) => ({ ...current, domains: [...current.domains, { domain: '', status: 'verified', domain_type: 'additional' }] }))
  }

  function updateDomain(index: number, key: keyof DomainRow, value: string) {
    setForm((current) => ({ ...current, domains: current.domains.map((d, i) => i === index ? { ...d, [key]: value } : d) }))
  }

  function removeDomain(index: number) {
    setForm((current) => ({ ...current, domains: current.domains.filter((_, i) => i !== index) }))
  }

  function addAdmin() {
    setForm((current) => ({ ...current, admins: [...current.admins, { email: '', role: 'district_admin' }] }))
  }

  function updateAdmin(index: number, key: keyof AdminRow, value: string) {
    setForm((current) => ({ ...current, admins: current.admins.map((a, i) => i === index ? { ...a, [key]: value } : a) }))
  }

  function removeAdmin(index: number) {
    setForm((current) => ({ ...current, admins: current.admins.filter((_, i) => i !== index) }))
  }

  function addAllowedUser() {
    setForm((current) => ({ ...current, allowedUsers: [...current.allowedUsers, { email: '', name: '', note: '', status: 'active' }] }))
  }

  function updateAllowedUser(index: number, key: keyof AllowedUserRow, value: string) {
    setForm((current) => ({ ...current, allowedUsers: current.allowedUsers.map((u, i) => i === index ? { ...u, [key]: value } : u) }))
  }

  function removeAllowedUser(index: number) {
    setForm((current) => ({ ...current, allowedUsers: current.allowedUsers.filter((_, i) => i !== index) }))
  }

  if (!user) {
    return (
      <main>
        <div className="card heroCard">
          <h1>Dock HQ</h1>
          <p className="muted">Owner-only district licensing and setup. Sign in with the Dock owner account.</p>
          <button type="button" onClick={signIn}>Sign in</button>
        </div>
      </main>
    )
  }

  return (
    <main>
      <div className="card heroCard">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>Dock HQ</h1>
            <p className="muted">Create districts, control licenses, verify domains, and assign school admins.</p>
            <p className="muted">Logged in as: {user.email}</p>
          </div>
          <div className="row wrap">
            <button type="button" className="secondary" onClick={loadDistricts} disabled={loading}>Refresh</button>
            <button type="button" className="secondary" onClick={signOut}>Logout</button>
          </div>
        </div>
      </div>

      <div className="card statusCard">
        <div className="statusGrid">
          <div className="statusBlock"><span className="statusLabel">Districts</span><strong>{districts.length}</strong></div>
          <div className="statusBlock"><span className="statusLabel">Selected</span><strong>{form.organization.org_code || 'New'}</strong></div>
          <div className="statusBlock"><span className="statusLabel">Seats Used</span><strong>{activeDistrict?.activeSeatCount ?? '—'} / {form.organization.max_users || '—'}</strong></div>
          <div className="statusBlock"><span className="statusLabel">Status</span><strong>{form.organization.license_status}</strong></div>
        </div>
      </div>

      <div className="card">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2>Districts</h2>
          <button type="button" onClick={startNew}>Create New District</button>
        </div>
        <div className="memoryList">
          {districts.map((district) => (
            <div className="memoryCard" key={district.organization.id}>
              <div className="memoryCardHeader">
                <div>
                  <strong>{district.organization.name}</strong>
                  <div className="memoryMeta">{district.organization.org_code} · {district.organization.email_domain || 'no primary domain'} · v{district.publishedWorkspace?.version || '—'}</div>
                </div>
                <span className="memoryBadge">{district.organization.license_status || 'trial'} · {district.activeSeatCount || 0}/{district.organization.max_users || 0}</span>
              </div>
              <div className="row wrap">
                <button type="button" className="secondary" onClick={() => setForm(toForm(district))}>Edit License</button>
                <a className="buttonLink secondaryLink" href={`/district/${district.organization.org_code}`} target="_blank" rel="noreferrer">Preview</a>
                <a className="buttonLink secondaryLink" href={`/api/org/${district.organization.org_code}/workspace`} target="_blank" rel="noreferrer">JSON</a>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>License + District Profile</h2>
        <div className="grid">
          <label>District Name<input value={form.organization.name} onChange={(e) => {
            updateOrg('name', e.target.value)
            if (!form.organization.org_code) updateOrg('org_code', slugify(e.target.value))
          }} /></label>
          <label>Org Code<input value={form.organization.org_code} onChange={(e) => updateOrg('org_code', slugify(e.target.value))} /></label>
          <label>Primary Email Domain<input value={form.organization.email_domain} onChange={(e) => updateOrg('email_domain', normalizeDomain(e.target.value))} placeholder="district.k12.us" /></label>
          <label>Plan<select value={form.organization.plan} onChange={(e) => updateOrg('plan', e.target.value)}><option value="district">District</option><option value="pilot">Pilot</option><option value="school">School</option></select></label>
          <label>Seats<input type="number" value={form.organization.max_users} onChange={(e) => updateOrg('max_users', Number(e.target.value) || 1)} /></label>
          <label>License Status<select value={form.organization.license_status} onChange={(e) => updateOrg('license_status', e.target.value)}><option value="trial">Trial</option><option value="active">Active</option><option value="past_due">Past Due</option><option value="suspended">Suspended</option><option value="expired">Expired</option></select></label>
          <label>Renewal Date<input type="date" value={form.organization.license_renewal_date} onChange={(e) => updateOrg('license_renewal_date', e.target.value)} /></label>
          <label>Grace Days<input type="number" value={form.organization.grace_period_days} onChange={(e) => updateOrg('grace_period_days', Number(e.target.value) || 0)} /></label>
          <label>Minimum Extension Version<input value={form.organization.minimum_extension_version} onChange={(e) => updateOrg('minimum_extension_version', e.target.value)} placeholder="0.2.3" /></label>
          <label className="gridSpan2">Owner Notes<input value={form.organization.owner_notes} onChange={(e) => updateOrg('owner_notes', e.target.value)} placeholder="Renewal notes, billing notes, special access notes" /></label>
        </div>
      </div>

      <div className="card">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}><h2>Verified Domains</h2><button type="button" className="secondary" onClick={addDomain}>Add Domain</button></div>
        {form.domains.map((entry, index) => <div className="tabCard" key={`domain-${index}`}><div className="tabMainRow"><input value={entry.domain} onChange={(e) => updateDomain(index, 'domain', normalizeDomain(e.target.value))} placeholder="school.k12.us" /><select value={entry.status} onChange={(e) => updateDomain(index, 'status', e.target.value)}><option value="verified">Verified</option><option value="pending">Pending</option></select><select value={entry.domain_type} onChange={(e) => updateDomain(index, 'domain_type', e.target.value)}><option value="primary">Primary</option><option value="additional">Additional</option></select><div className="tabActions"><button type="button" className="secondary" onClick={() => removeDomain(index)}>Remove</button></div></div></div>)}
      </div>

      <div className="card">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}><h2>District Admins</h2><button type="button" className="secondary" onClick={addAdmin}>Add Admin</button></div>
        {form.admins.map((entry, index) => <div className="tabCard" key={`admin-${index}`}><div className="tabMainRow"><input value={entry.email} onChange={(e) => updateAdmin(index, 'email', e.target.value)} placeholder="tech@district.k12.us" /><select value={entry.role} onChange={(e) => updateAdmin(index, 'role', e.target.value)}><option value="district_admin">District Admin</option><option value="owner">District Owner</option></select><div className="tabActions"><button type="button" className="secondary" onClick={() => removeAdmin(index)}>Remove</button></div></div></div>)}
      </div>

      <div className="card">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}><h2>Outside-Domain Allowed Users</h2><button type="button" className="secondary" onClick={addAllowedUser}>Add User</button></div>
        <p className="muted">Use this for contractors, board members, consultants, or staff without the district email domain.</p>
        {form.allowedUsers.map((entry, index) => <div className="tabCard" key={`allowed-${index}`}><div className="tabMainRow"><input value={entry.email} onChange={(e) => updateAllowedUser(index, 'email', e.target.value)} placeholder="person@gmail.com" /><input value={entry.name || ''} onChange={(e) => updateAllowedUser(index, 'name', e.target.value)} placeholder="Name" /><select value={entry.status} onChange={(e) => updateAllowedUser(index, 'status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select><div className="tabActions"><button type="button" className="secondary" onClick={() => removeAllowedUser(index)}>Remove</button></div></div><input value={entry.note || ''} onChange={(e) => updateAllowedUser(index, 'note', e.target.value)} placeholder="Why this outside user is allowed" /></div>)}
      </div>

      <div className="card actionBarCard">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row wrap"><button type="button" onClick={saveDistrict} disabled={loading}>{loading ? 'Working…' : 'Save District License'}</button></div>
          <span className="status">{status}</span>
        </div>
      </div>
    </main>
  )
}
