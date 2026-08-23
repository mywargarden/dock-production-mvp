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

function statusTone(status: string) {
  if (status === 'active') return 'hqToneGood'
  if (status === 'past_due' || status === 'trial') return 'hqToneWarn'
  if (status === 'suspended' || status === 'expired') return 'hqToneBad'
  return 'hqToneNeutral'
}

export default function OwnerPage() {
  const [user, setUser] = useState<any>(null)
  const [districts, setDistricts] = useState<any[]>([])
  const [form, setForm] = useState<DistrictForm>(blankDistrict)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  const activeDistrict = useMemo(() => districts.find((d) => d.organization?.org_code === form.organization.org_code), [districts, form.organization.org_code])
  const totalSeats = useMemo(() => districts.reduce((sum, d) => sum + (Number(d.organization?.max_users) || 0), 0), [districts])
  const seatsUsed = useMemo(() => districts.reduce((sum, d) => sum + (Number(d.activeSeatCount) || 0), 0), [districts])
  const activeLicenses = useMemo(() => districts.filter((d) => d.organization?.license_status === 'active').length, [districts])
  const attentionLicenses = useMemo(() => districts.filter((d) => ['past_due', 'suspended', 'expired'].includes(d.organization?.license_status)).length, [districts])

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
      setStatus('Saving district license...')
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
    document.getElementById('district-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function editDistrict(district: any) {
    setForm(toForm(district))
    setStatus(`Editing ${district.organization?.name || 'district'}.`)
    document.getElementById('district-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      <main className="hqSignInShell">
        <div className="hqSignInCard">
          <div className="hqBrandMark">D</div>
          <div className="hqEyebrow">Dock Owner Control Plane</div>
          <h1>Dock HQ</h1>
          <p>One private command center for customers, licensing, rollout, branding, and the systems that run Dock.</p>
          <button type="button" onClick={signIn}>Enter Dock HQ</button>
        </div>
      </main>
    )
  }

  return (
    <div className="hqAppShell">
      <aside className="hqSidebar">
        <div className="hqBrand">
          <div className="hqBrandMark">D</div>
          <div><strong>Dock HQ</strong><span>Owner Console</span></div>
        </div>

        <nav className="hqNav" aria-label="Dock HQ">
          <a className="active" href="#overview"><span>01</span> Overview</a>
          <a href="#districts"><span>02</span> Districts</a>
          <a href="#district-workbench"><span>03</span> Licenses & Access</a>
          <a href="#owner-tools"><span>04</span> Owner Tools</a>
          <a href="#operations"><span>05</span> Operations</a>
        </nav>

        <div className="hqSidebarFooter">
          <div className="hqUserDot">{String(user.email || 'O').slice(0, 1).toUpperCase()}</div>
          <div className="hqSidebarUser"><strong>Owner</strong><span>{user.email}</span></div>
        </div>
      </aside>

      <main className="hqMain">
        <section className="hqTopbar" id="overview">
          <div>
            <div className="hqEyebrow">Command Center</div>
            <h1>Good to see you. Dock is on the board.</h1>
            <p>Manage every district, license, admin, rollout, and owner-level control from one place.</p>
          </div>
          <div className="hqTopActions">
            <button type="button" className="secondary" onClick={loadDistricts} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
            <button type="button" className="secondary" onClick={signOut}>Logout</button>
            <button type="button" onClick={startNew}>+ New District</button>
          </div>
        </section>

        <section className="hqMetrics" aria-label="Dock HQ overview metrics">
          <div className="hqMetric hqMetricPrimary"><span>Districts</span><strong>{districts.length}</strong><small>customer organizations</small></div>
          <div className="hqMetric"><span>Licensed Seats</span><strong>{totalSeats.toLocaleString()}</strong><small>{seatsUsed.toLocaleString()} currently in use</small></div>
          <div className="hqMetric"><span>Active Licenses</span><strong>{activeLicenses}</strong><small>{districts.length - activeLicenses} trial or other</small></div>
          <div className={`hqMetric ${attentionLicenses ? 'hqMetricAlert' : ''}`}><span>Needs Attention</span><strong>{attentionLicenses}</strong><small>past due, suspended, expired</small></div>
        </section>

        <section className="hqCommandGrid" id="owner-tools">
          <div className="hqPanel hqControlPanel">
            <div className="hqPanelHeader"><div><span className="hqKicker">Owner Tools</span><h2>The mothership</h2></div><span className="hqLivePill">OWNER ONLY</span></div>
            <div className="hqToolGrid">
              <a className="hqToolCard" href="#districts"><b>Districts</b><span>Create customers and manage every organization.</span><em>Open directory →</em></a>
              <a className="hqToolCard" href="#district-workbench"><b>Licenses & Seats</b><span>Plans, limits, renewals, grace periods, and access.</span><em>Manage licenses →</em></a>
              <a className="hqToolCard" href="/admin"><b>Publishing</b><span>Open the current admin workspace and managed content tools.</span><em>Open admin →</em></a>
              <a className="hqToolCard" href="#district-workbench"><b>Domains & Admins</b><span>Verified domains, district admins, and outside users.</span><em>Manage access →</em></a>
              <div className="hqToolCard hqToolPlanned"><b>Themes & Branding</b><span>Global theme library, district branding, and theme assignments.</span><em>Next owner module</em></div>
              <div className="hqToolCard hqToolPlanned"><b>Billing & Revenue</b><span>Stripe status, invoices, payment health, and renewals.</span><em>Next owner module</em></div>
              <div className="hqToolCard hqToolPlanned"><b>Release Control</b><span>Minimum versions, rollout state, and deployment readiness.</span><em>Next owner module</em></div>
              <div className="hqToolCard hqToolPlanned"><b>Diagnostics</b><span>Tenant health, license failures, bootstrap state, and audit trail.</span><em>Next owner module</em></div>
            </div>
          </div>

          <aside className="hqPanel hqPulsePanel" id="operations">
            <div className="hqPanelHeader"><div><span className="hqKicker">System Pulse</span><h2>Today</h2></div><span className="hqPulseDot" /></div>
            <div className="hqPulseList">
              <div><span>Owner authentication</span><strong className="hqGood">Online</strong></div>
              <div><span>District records</span><strong className="hqGood">{districts.length} loaded</strong></div>
              <div><span>Seat utilization</span><strong>{totalSeats ? Math.round((seatsUsed / totalSeats) * 100) : 0}%</strong></div>
              <div><span>Selected tenant</span><strong>{form.organization.org_code || 'None'}</strong></div>
              <div><span>License attention</span><strong className={attentionLicenses ? 'hqBad' : 'hqGood'}>{attentionLicenses}</strong></div>
            </div>
            <div className="hqStatusBox"><span>HQ Status</span><p>{status || 'Dock HQ is ready.'}</p></div>
          </aside>
        </section>

        <section className="hqPanel" id="districts">
          <div className="hqPanelHeader">
            <div><span className="hqKicker">Customer Directory</span><h2>Districts</h2><p>Every tenant in one owner-level directory.</p></div>
            <button type="button" onClick={startNew}>+ Create District</button>
          </div>

          <div className="hqDistrictTable">
            <div className="hqDistrictTableHead"><span>Organization</span><span>License</span><span>Seats</span><span>Workspace</span><span>Actions</span></div>
            {districts.map((district) => {
              const licenseStatus = district.organization?.license_status || 'trial'
              return (
                <div className="hqDistrictRow" key={district.organization.id}>
                  <div className="hqDistrictIdentity"><div className="hqDistrictAvatar">{String(district.organization.name || 'D').slice(0, 2).toUpperCase()}</div><div><strong>{district.organization.name}</strong><span>{district.organization.email_domain || 'No primary domain'} · {district.organization.org_code}</span></div></div>
                  <div><span className={`hqStatusPill ${statusTone(licenseStatus)}`}>{licenseStatus.replace('_', ' ')}</span></div>
                  <div className="hqSeatCell"><strong>{district.activeSeatCount || 0}/{district.organization.max_users || 0}</strong><span>active</span></div>
                  <div className="hqSeatCell"><strong>v{district.publishedWorkspace?.version || '—'}</strong><span>published</span></div>
                  <div className="hqRowActions">
                    <button type="button" className="secondary" onClick={() => editDistrict(district)}>Manage</button>
                    <a className="hqMiniLink" href={`/district/${district.organization.org_code}`} target="_blank" rel="noreferrer">Preview</a>
                    <a className="hqMiniLink" href={`/api/org/${district.organization.org_code}/workspace`} target="_blank" rel="noreferrer">JSON</a>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="hqWorkbench" id="district-workbench">
          <div className="hqWorkbenchIntro">
            <div><span className="hqKicker">District Workbench</span><h2>{form.organization.name || 'New District'}</h2><p>{form.organization.org_code ? `Owner controls for ${form.organization.org_code}` : 'Create a customer profile and license.'}</p></div>
            <div className="hqWorkbenchStats">
              <div><span>Status</span><strong className={`hqStatusText ${statusTone(form.organization.license_status)}`}>{form.organization.license_status.replace('_', ' ')}</strong></div>
              <div><span>Seats</span><strong>{activeDistrict?.activeSeatCount ?? '—'} / {form.organization.max_users || '—'}</strong></div>
            </div>
          </div>

          <div className="hqPanel hqFormPanel">
            <div className="hqSectionTitle"><div><h3>License + District Profile</h3><p>Commercial and tenant-level settings controlled only from Dock HQ.</p></div></div>
            <div className="grid">
              <label>District Name<input value={form.organization.name} onChange={(e) => { updateOrg('name', e.target.value); if (!form.organization.org_code) updateOrg('org_code', slugify(e.target.value)) }} /></label>
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

          <div className="hqTwoCol">
            <div className="hqPanel hqFormPanel">
              <div className="hqSectionTitle"><div><h3>Verified Domains</h3><p>Domains allowed to resolve into this district.</p></div><button type="button" className="secondary" onClick={addDomain}>+ Domain</button></div>
              {form.domains.length === 0 && <div className="hqEmpty">No verified domains yet.</div>}
              {form.domains.map((entry, index) => <div className="hqCompactRow" key={`domain-${index}`}><input value={entry.domain} onChange={(e) => updateDomain(index, 'domain', normalizeDomain(e.target.value))} placeholder="school.k12.us" /><select value={entry.status} onChange={(e) => updateDomain(index, 'status', e.target.value)}><option value="verified">Verified</option><option value="pending">Pending</option></select><select value={entry.domain_type} onChange={(e) => updateDomain(index, 'domain_type', e.target.value)}><option value="primary">Primary</option><option value="additional">Additional</option></select><button type="button" className="hqRemove" onClick={() => removeDomain(index)}>Remove</button></div>)}
            </div>

            <div className="hqPanel hqFormPanel">
              <div className="hqSectionTitle"><div><h3>District Admins</h3><p>People allowed into the district admin workspace.</p></div><button type="button" className="secondary" onClick={addAdmin}>+ Admin</button></div>
              {form.admins.length === 0 && <div className="hqEmpty">No district admins yet.</div>}
              {form.admins.map((entry, index) => <div className="hqCompactRow hqCompactRowAdmin" key={`admin-${index}`}><input value={entry.email} onChange={(e) => updateAdmin(index, 'email', e.target.value)} placeholder="tech@district.k12.us" /><select value={entry.role} onChange={(e) => updateAdmin(index, 'role', e.target.value)}><option value="district_admin">District Admin</option><option value="owner">District Owner</option></select><button type="button" className="hqRemove" onClick={() => removeAdmin(index)}>Remove</button></div>)}
            </div>
          </div>

          <div className="hqPanel hqFormPanel">
            <div className="hqSectionTitle"><div><h3>Outside-Domain Allowed Users</h3><p>Explicit exceptions for contractors, board members, consultants, or staff without the district domain.</p></div><button type="button" className="secondary" onClick={addAllowedUser}>+ User</button></div>
            {form.allowedUsers.length === 0 && <div className="hqEmpty">No outside-domain exceptions. That is the preferred default.</div>}
            {form.allowedUsers.map((entry, index) => <div className="hqAllowedRow" key={`allowed-${index}`}><div className="hqAllowedTop"><input value={entry.email} onChange={(e) => updateAllowedUser(index, 'email', e.target.value)} placeholder="person@gmail.com" /><input value={entry.name || ''} onChange={(e) => updateAllowedUser(index, 'name', e.target.value)} placeholder="Name" /><select value={entry.status} onChange={(e) => updateAllowedUser(index, 'status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select><button type="button" className="hqRemove" onClick={() => removeAllowedUser(index)}>Remove</button></div><input value={entry.note || ''} onChange={(e) => updateAllowedUser(index, 'note', e.target.value)} placeholder="Why this outside user is allowed" /></div>)}
          </div>

          <div className="hqSaveBar">
            <div><span className="hqKicker">Owner Change Control</span><strong>{status || 'No unsaved operation running.'}</strong></div>
            <div className="hqTopActions"><button type="button" className="secondary" onClick={loadDistricts} disabled={loading}>Discard / Reload</button><button type="button" onClick={saveDistrict} disabled={loading}>{loading ? 'Working...' : 'Save District License'}</button></div>
          </div>
        </section>
      </main>
    </div>
  )
}
