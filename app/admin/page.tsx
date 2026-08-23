'use client';

import { useEffect, useMemo, useState } from 'react';

type District = {
  id: string;
  district_id: string;
  name: string;
  contact_email?: string | null;
  dock_licenses?: Array<{ id: string; status: string; max_users: number; min_extension_version: string; expires_at?: string | null }>;
  dock_district_domains?: Array<{ id: string; domain: string; auto_assign: boolean }>;
};

type LicenseUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  status: string;
  district_id: string;
  last_seen_at?: string | null;
};

function statusBadge(status?: string) {
  const s = status || 'unknown';
  const bad = ['suspended', 'inactive', 'expired', 'canceled', 'disabled', 'terminated'].includes(s);
  const warn = ['past_due', 'grace'].includes(s);
  return <span className={`badge ${bad ? 'bad' : warn ? 'warn' : ''}`}>{s}</span>;
}

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState('');
  const [districts, setDistricts] = useState<District[]>([]);
  const [users, setUsers] = useState<LicenseUser[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newDistrict, setNewDistrict] = useState({ districtId: 'hcps', name: 'Henry County Public Schools', domain: 'henry.k12.va.us', status: 'active', maxUsers: '500' });
  const [newUser, setNewUser] = useState({ districtId: '', email: '', name: '', role: 'teacher' });

  useEffect(() => {
    const existing = window.sessionStorage.getItem('dockAdminToken') || '';
    setToken(existing);
    setSavedToken(existing);
  }, []);

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${savedToken}`,
  }), [savedToken]);

  async function api(path: string, options: RequestInit = {}) {
    setError('');
    setMessage('');
    const res = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }

  async function loadAll() {
    try {
      const [d, u] = await Promise.all([
        api('/api/admin/districts'),
        api('/api/admin/users'),
      ]);
      setDistricts(d.districts || []);
      setUsers(u.users || []);
      if (!newUser.districtId && d.districts?.[0]?.id) {
        setNewUser((prev) => ({ ...prev, districtId: d.districts[0].id }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load admin data');
    }
  }

  function saveToken() {
    window.sessionStorage.setItem('dockAdminToken', token);
    setSavedToken(token);
    setMessage('Admin token saved for this browser session.');
  }

  useEffect(() => {
    if (savedToken) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedToken]);

  async function createDistrict() {
    try {
      await api('/api/admin/districts', {
        method: 'POST',
        body: JSON.stringify({ ...newDistrict, maxUsers: Number(newDistrict.maxUsers || 0) }),
      });
      setMessage('District created.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create district');
    }
  }

  async function setLicenseStatus(id: string, status: string) {
    try {
      await api(`/api/admin/districts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ licenseStatus: status }),
      });
      setMessage(`License set to ${status}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update license');
    }
  }

  async function addUser() {
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify(newUser) });
      setMessage('User added or updated.');
      setNewUser((prev) => ({ ...prev, email: '', name: '' }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add user');
    }
  }

  async function deleteUser(id: string) {
    try {
      await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      setMessage('User removed.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete user');
    }
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div className="brand">
          <small>Dock Admin</small>
          <h1>License Command Center</h1>
          <p className="muted">Create districts, assign domains, manage users, control license status, and monitor seats.</p>
        </div>
        <button onClick={loadAll}>Refresh</button>
      </section>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <section className="grid">
        <div className="card span12">
          <h2>Admin access</h2>
          <div className="row">
            <input placeholder="Paste DOCK_ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} />
            <button onClick={saveToken}>Use token</button>
          </div>
          <p className="muted">The token is stored only in this browser tab session. Set DOCK_ADMIN_TOKEN in Vercel environment variables.</p>
        </div>

        <div className="card span4">
          <h2>Create district</h2>
          <label>District ID<input value={newDistrict.districtId} onChange={(e) => setNewDistrict({ ...newDistrict, districtId: e.target.value })} /></label><br />
          <label>Name<input value={newDistrict.name} onChange={(e) => setNewDistrict({ ...newDistrict, name: e.target.value })} /></label><br />
          <label>Auto-assign domain<input value={newDistrict.domain} onChange={(e) => setNewDistrict({ ...newDistrict, domain: e.target.value })} /></label><br />
          <label>Status<select value={newDistrict.status} onChange={(e) => setNewDistrict({ ...newDistrict, status: e.target.value })}>
            <option>active</option><option>trial</option><option>past_due</option><option>suspended</option><option>expired</option><option>canceled</option>
          </select></label><br />
          <label>Max users<input value={newDistrict.maxUsers} onChange={(e) => setNewDistrict({ ...newDistrict, maxUsers: e.target.value })} /></label><br />
          <button onClick={createDistrict}>Create district license</button>
        </div>

        <div className="card span8">
          <h2>District licenses</h2>
          <table className="table">
            <thead><tr><th>District</th><th>Domains</th><th>Status</th><th>Seats</th><th>Actions</th></tr></thead>
            <tbody>
              {districts.map((d) => {
                const license = d.dock_licenses?.[0];
                const used = users.filter((u) => u.district_id === d.id).length;
                return <tr key={d.id}>
                  <td><strong>{d.name}</strong><br /><span className="muted">{d.district_id}</span></td>
                  <td>{d.dock_district_domains?.map((x) => x.domain).join(', ') || '—'}</td>
                  <td>{statusBadge(license?.status)}</td>
                  <td>{used} / {license?.max_users ?? 0}</td>
                  <td className="row">
                    <button className="good" onClick={() => setLicenseStatus(d.id, 'active')}>Activate</button>
                    <button className="secondary" onClick={() => setLicenseStatus(d.id, 'past_due')}>Past due</button>
                    <button className="danger" onClick={() => setLicenseStatus(d.id, 'suspended')}>Suspend</button>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>

        <div className="card span4">
          <h2>Add / edit user</h2>
          <label>District<select value={newUser.districtId} onChange={(e) => setNewUser({ ...newUser, districtId: e.target.value })}>
            <option value="">Choose district</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label><br />
          <label>Email<input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></label><br />
          <label>Name<input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} /></label><br />
          <label>Role<select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
            <option>teacher</option><option>admin</option><option>it</option><option>owner</option>
          </select></label><br />
          <button onClick={addUser}>Add / update user</button>
        </div>

        <div className="card span8">
          <h2>Users on licenses</h2>
          <table className="table">
            <thead><tr><th>User</th><th>District</th><th>Role</th><th>Status</th><th>Last seen</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => <tr key={u.id}>
                <td><strong>{u.email}</strong><br /><span className="muted">{u.name || ''}</span></td>
                <td>{districts.find((d) => d.id === u.district_id)?.name || u.district_id}</td>
                <td>{u.role}</td>
                <td>{statusBadge(u.status)}</td>
                <td>{u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : '—'}</td>
                <td><button className="danger" onClick={() => deleteUser(u.id)}>Remove</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
