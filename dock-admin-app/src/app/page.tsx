
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type TabRow = { title: string; url: string; icon_url?: string; is_locked?: boolean };

type Organization = {
  id?: string;
  name: string;
  org_code: string;
  email_domain: string;
  plan: string;
  max_users: number;
};

const INITIAL_TABS: TabRow[] = [
  { title: 'Gmail', url: 'https://mail.google.com/' },
  { title: 'Canvas', url: 'https://henry.instructure.com/' },
  { title: 'PowerSchool', url: 'https://hcva.powerschool.com/teachers/pw.html' },
  { title: 'ParentSquare', url: 'https://www.parentsquare.com/' },
  { title: 'ClassLink', url: 'https://launchpad.classlink.com/' }
];

export default function Home() {
  const [org, setOrg] = useState<Organization>({
    name: 'Henry County Public Schools',
    org_code: 'henry-county',
    email_domain: 'henry.k12.va.us',
    plan: 'district',
    max_users: 500
  });
  const [workspaceName, setWorkspaceName] = useState('Henry County Teacher Workspace');
  const [tabs, setTabs] = useState<TabRow[]>(INITIAL_TABS);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const apiPreview = useMemo(() => `/api/org/${encodeURIComponent(org.org_code || 'district')}/workspace`, [org.org_code]);

  useEffect(() => {
    let active = true;
    async function loadExisting() {
      if (!org.org_code) return;
      const { data: orgRow } = await supabase
        .from('organizations')
        .select('*')
        .eq('org_code', org.org_code)
        .maybeSingle();
      if (!active || !orgRow) return;
      setOrg({
        id: orgRow.id,
        name: orgRow.name,
        org_code: orgRow.org_code,
        email_domain: orgRow.email_domain || '',
        plan: orgRow.plan || 'district',
        max_users: orgRow.max_users || 500
      });
      const { data: workspaceRow } = await supabase
        .from('workspaces')
        .select('*')
        .eq('organization_id', orgRow.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!active || !workspaceRow) return;
      setWorkspaceName(workspaceRow.name || 'District Workspace');
      const { data: tabRows } = await supabase
        .from('workspace_tabs')
        .select('*')
        .eq('workspace_id', workspaceRow.id)
        .order('position', { ascending: true });
      if (!active) return;
      if (Array.isArray(tabRows) && tabRows.length) {
        setTabs(tabRows.map((t: any) => ({ title: t.title, url: t.url, icon_url: t.icon_url || '', is_locked: t.is_locked })));
      }
    }
    loadExisting();
    return () => { active = false; };
  }, []);

  function updateTab(index: number, key: keyof TabRow, value: string | boolean) {
    setTabs((current) => current.map((tab, i) => i === index ? { ...tab, [key]: value } : tab));
  }

  function addTab() {
    setTabs((current) => [...current, { title: '', url: '', icon_url: '', is_locked: true }]);
  }

  function removeTab(index: number) {
    setTabs((current) => current.filter((_, i) => i !== index));
  }

  function moveTab(index: number, direction: -1 | 1) {
    setTabs((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function triggerIconPick(index: number) {
    const input = document.getElementById(`icon-upload-${index}`) as HTMLInputElement | null;
    input?.click();
  }

  function clearIcon(index: number) {
    setTabs((current) => current.map((tab, i) => i === index ? { ...tab, icon_url: '' } : tab));
  }

  async function handleIconUpload(index: number, file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('Please upload an image file for the icon.');
      return;
    }
    const maxBytes = 1024 * 1024 * 2;
    if (file.size > maxBytes) {
      setStatus('Icon file is too large. Keep it under 2 MB.');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read icon file.'));
      reader.readAsDataURL(file);
    });
    setTabs((current) => current.map((tab, i) => i === index ? { ...tab, icon_url: dataUrl } : tab));
    setStatus('Icon uploaded. Save Workspace to publish the new icon.');
  }

  function normalizedUrl(value: string) {
    const raw = (value || '').trim();
    if (!raw) return '';
    return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  }


  async function saveWorkspace() {
    try {
      setLoading(true);
      setStatus('Saving workspace…');
      const cleanTabs = tabs
        .map((tab) => ({
          title: tab.title.trim(),
          url: tab.url.trim(),
          icon_url: (tab.icon_url || '').trim(),
          is_locked: tab.is_locked !== false
        }))
        .filter((tab) => tab.url);
      if (!org.org_code.trim()) throw new Error('Organization code is required.');
      if (!workspaceName.trim()) throw new Error('Workspace name is required.');
      if (!cleanTabs.length) throw new Error('Add at least one tab before saving.');

      const { data: orgRow, error: orgError } = await supabase
        .from('organizations')
        .upsert({
          name: org.name.trim(),
          org_code: org.org_code.trim(),
          email_domain: org.email_domain.trim(),
          plan: org.plan,
          max_users: Number(org.max_users) || 500
        }, { onConflict: 'org_code' })
        .select('*')
        .single();
      if (orgError) throw orgError;

      const { data: workspaceExisting } = await supabase
        .from('workspaces')
        .select('*')
        .eq('organization_id', orgRow.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      let workspaceId = workspaceExisting?.id;
      if (workspaceId) {
        const { error } = await supabase
          .from('workspaces')
          .update({ name: workspaceName.trim(), updated_at: Date.now(), is_locked: true })
          .eq('id', workspaceId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('workspaces')
          .insert({ organization_id: orgRow.id, name: workspaceName.trim(), updated_at: Date.now(), is_locked: true })
          .select('*')
          .single();
        if (error) throw error;
        workspaceId = data.id;
      }

      const { error: deleteError } = await supabase.from('workspace_tabs').delete().eq('workspace_id', workspaceId);
      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase.from('workspace_tabs').insert(
        cleanTabs.map((tab, index) => ({
          workspace_id: workspaceId,
          title: tab.title || new URL(tab.url).hostname,
          url: tab.url.startsWith('http://') || tab.url.startsWith('https://') ? tab.url : `https://${tab.url}`,
          icon_url: tab.icon_url || null,
          position: index,
          is_locked: tab.is_locked !== false
        }))
      );
      if (insertError) throw insertError;

      setStatus(`Saved ${cleanTabs.length} tab(s). Dock endpoint ready at ${apiPreview}`);
    } catch (error: any) {
      setStatus(error?.message || 'Save failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="card">
        <h1>Dock Admin MVP</h1>
        <p className="muted">Manage one district workspace, save it to Supabase, and let Dock fetch it by org code.</p>
      </div>

      <div className="card">
        <h2>Organization</h2>
        <div className="grid">
          <label>Organization Name
            <input value={org.name} onChange={(e) => setOrg((current) => ({ ...current, name: e.target.value }))} />
          </label>
          <label>Organization Code
            <input value={org.org_code} onChange={(e) => setOrg((current) => ({ ...current, org_code: e.target.value }))} />
          </label>
          <label>Email Domain
            <input value={org.email_domain} onChange={(e) => setOrg((current) => ({ ...current, email_domain: e.target.value }))} />
          </label>
          <label>Plan
            <select value={org.plan} onChange={(e) => setOrg((current) => ({ ...current, plan: e.target.value }))}>
              <option value="district">District</option>
              <option value="pro">Pro</option>
              <option value="free">Free</option>
            </select>
          </label>
          <label>Max Users
            <input type="number" value={org.max_users} onChange={(e) => setOrg((current) => ({ ...current, max_users: Number(e.target.value) || 500 }))} />
          </label>
          <label>Dock API Preview
            <input value={apiPreview} readOnly />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Workspace</h2>
        <div className="grid">
          <label>Workspace Name
            <input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2>Tabs</h2>
          <button type="button" onClick={addTab}>Add Tab</button>
        </div>
        {tabs.map((tab, index) => (
          <div className="tabCard" key={index}>
            <div className="tabMainRow">
              <input value={tab.title} onChange={(e) => updateTab(index, 'title', e.target.value)} placeholder="Title" />
              <input value={tab.url} onChange={(e) => updateTab(index, 'url', e.target.value)} placeholder="https://example.com" />
              <div className="tabActions">
                <button type="button" className="secondary" onClick={() => moveTab(index, -1)}>↑</button>
                <button type="button" className="secondary" onClick={() => removeTab(index)}>Remove</button>
              </div>
            </div>

            <div className="iconUploadRow">
              <div className="iconPreviewBox">
                {tab.icon_url ? (
                  <img src={tab.icon_url} alt={`${tab.title || 'Tab'} icon preview`} />
                ) : (
                  <img src="/dock-placeholder.png" alt="Dock placeholder" />
                )}
              </div>

              <div
                className="iconControls"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  handleIconUpload(index, file);
                }}
              >
                <div className="row wrap">
                  <button type="button" onClick={() => triggerIconPick(index)}>Upload Icon</button>
                  <button type="button" className="secondary" onClick={() => clearIcon(index)}>Clear Icon</button>
                </div>
                <input
                  id={`icon-upload-${index}`}
                  className="hiddenInput"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={(e) => handleIconUpload(index, e.target.files?.[0] || null)}
                />
                <div className="dropZone">
                  <strong>Drag & drop icon here</strong>
                  <span>or click Upload Icon</span>
                </div>
                <div className="helpText">
                  Use a square PNG when possible. 256×256 or 512×512 works best. Uploaded icons stay crisp in full and compact views.
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row wrap">
          <button type="button" onClick={saveWorkspace} disabled={loading}>{loading ? 'Saving…' : 'Save Workspace'}</button>
          <span className="status">{status}</span>
        </div>
      </div>
    </main>
  );
}
