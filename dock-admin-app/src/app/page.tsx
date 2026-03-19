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
  published_at?: string | null;
};
type SessionState = 'loading' | 'signed_out' | 'signed_in';

const INITIAL_TABS: TabRow[] = [
  { title: 'Gmail', url: 'https://mail.google.com/' },
  { title: 'Canvas', url: 'https://henry.instructure.com/' },
  { title: 'PowerSchool', url: 'https://hcva.powerschool.com/teachers/pw.html' },
  { title: 'ParentSquare', url: 'https://www.parentsquare.com/' },
  { title: 'ClassLink', url: 'https://launchpad.classlink.com/' }
];

export default function Home() {
  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [email, setEmail] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [org, setOrg] = useState<Organization>({
    name: 'Henry County Public Schools',
    org_code: 'henry-county',
    email_domain: 'henry.k12.va.us',
    plan: 'district',
    max_users: 500,
    published_at: null
  });
  const [workspaceName, setWorkspaceName] = useState('Henry County Teacher Workspace');
  const [tabs, setTabs] = useState<TabRow[]>(INITIAL_TABS);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const apiPreview = useMemo(() => `/api/org/${encodeURIComponent(org.org_code || 'district')}/workspace`, [org.org_code]);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const session = data.session;
      if (session?.user) {
        setUserEmail(session.user.email || '');
        setEmail(session.user.email || '');
        setSessionState('signed_in');
      } else {
        setSessionState('signed_out');
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session?.user) {
        setUserEmail(session.user.email || '');
        setEmail(session.user.email || '');
        setSessionState('signed_in');
      } else {
        setUserEmail('');
        setSessionState('signed_out');
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (sessionState !== 'signed_in') return;
    let active = true;
    async function loadForUser() {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) return;
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_id, email')
        .eq('id', user.id)
        .maybeSingle();
      if (!active) return;
      if (profileError) {
        setStatus(profileError.message);
        return;
      }
      if (!profile?.organization_id) {
        setStatus('Your login works, but this account is not attached to an organization yet. Run the bootstrap insert in supabase-schema.sql with your auth user UUID.');
        return;
      }

      const { data: orgRow, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', profile.organization_id)
        .maybeSingle();
      if (!active) return;
      if (orgError) {
        setStatus(orgError.message);
        return;
      }
      if (!orgRow) {
        setStatus('Organization not found for this admin account.');
        return;
      }

      const draftTabs = Array.isArray(orgRow.draft_tabs) && orgRow.draft_tabs.length
        ? orgRow.draft_tabs
        : INITIAL_TABS;

      setOrg({
        id: orgRow.id,
        name: orgRow.name,
        org_code: orgRow.org_code,
        email_domain: orgRow.email_domain || '',
        plan: orgRow.plan || 'district',
        max_users: orgRow.max_users || 500,
        published_at: orgRow.published_at || null
      });
      setWorkspaceName(orgRow.draft_workspace_name || 'District Workspace');
      setTabs(draftTabs.map((t: any) => ({
        title: String(t?.title || ''),
        url: String(t?.url || ''),
        icon_url: String(t?.icon_url || ''),
        is_locked: t?.is_locked !== false
      })));
      setStatus(orgRow.published_at ? `Live workspace published ${new Date(orgRow.published_at).toLocaleString()}` : 'No published workspace yet. Save Draft, then Publish Live Workspace.');
    }
    loadForUser();
    return () => { active = false; };
  }, [sessionState]);

  function updateTab(index: number, key: keyof TabRow, value: string | boolean) {
    setTabs((current) => current.map((tab, i) => i === index ? { ...tab, [key]: value } : tab));
  }
  function addTab() { setTabs((current) => [...current, { title: '', url: '', icon_url: '', is_locked: true }]); }
  function removeTab(index: number) { setTabs((current) => current.filter((_, i) => i !== index)); }
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
    setStatus('Icon uploaded. Save Draft to keep this draft, then Publish Live Workspace to push it.');
  }

  async function sendMagicLink() {
    try {
      setLoading(true);
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : undefined);
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: siteUrl
        }
      });
      if (error) throw error;
      setStatus('Magic link sent. Open it from your email on this same browser.');
    } catch (error: any) {
      setStatus(error?.message || 'Could not send magic link.');
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setStatus('Signed out.');
  }

  function cleanTabs() {
    return tabs
      .map((tab) => ({
        title: (tab.title || '').trim(),
        url: (tab.url || '').trim(),
        icon_url: (tab.icon_url || '').trim(),
        is_locked: tab.is_locked !== false
      }))
      .filter((tab) => tab.url);
  }

  async function saveDraft() {
    try {
      if (!org.id) throw new Error('Your admin account is not linked to an organization yet.');
      setLoading(true);
      const clean = cleanTabs();
      if (!workspaceName.trim()) throw new Error('Workspace name is required.');
      if (!clean.length) throw new Error('Add at least one tab before saving.');
      const { error } = await supabase
        .from('organizations')
        .update({
          name: org.name.trim(),
          email_domain: org.email_domain.trim(),
          plan: org.plan,
          max_users: Number(org.max_users) || 500,
          draft_workspace_name: workspaceName.trim(),
          draft_tabs: clean
        })
        .eq('id', org.id);
      if (error) throw error;
      setStatus(`Draft saved (${clean.length} tab(s)). Publish Live Workspace when ready.`);
    } catch (error: any) {
      setStatus(error?.message || 'Draft save failed.');
    } finally {
      setLoading(false);
    }
  }

  async function publishWorkspace() {
    try {
      if (!org.id) throw new Error('Your admin account is not linked to an organization yet.');
      setLoading(true);
      const clean = cleanTabs();
      if (!clean.length) throw new Error('Add at least one tab before publishing.');

      const { data: workspaceExisting, error: fetchWsError } = await supabase
        .from('workspaces')
        .select('*')
        .eq('organization_id', org.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (fetchWsError) throw fetchWsError;

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
          .insert({ organization_id: org.id, name: workspaceName.trim(), updated_at: Date.now(), is_locked: true })
          .select('*')
          .single();
        if (error) throw error;
        workspaceId = data.id;
      }

      const { error: deleteError } = await supabase.from('workspace_tabs').delete().eq('workspace_id', workspaceId);
      if (deleteError) throw deleteError;

      const rows = clean.map((tab, index) => ({
        workspace_id: workspaceId,
        title: tab.title || (() => { try { return new URL(/^https?:\/\//i.test(tab.url) ? tab.url : `https://${tab.url}`).hostname; } catch { return 'Untitled'; } })(),
        url: /^https?:\/\//i.test(tab.url) ? tab.url : `https://${tab.url}`,
        icon_url: tab.icon_url || null,
        position: index,
        is_locked: tab.is_locked !== false
      }));
      const { error: insertError } = await supabase.from('workspace_tabs').insert(rows);
      if (insertError) throw insertError;

      const nowIso = new Date().toISOString();
      const { error: orgUpdateError } = await supabase
        .from('organizations')
        .update({
          name: org.name.trim(),
          email_domain: org.email_domain.trim(),
          plan: org.plan,
          max_users: Number(org.max_users) || 500,
          draft_workspace_name: workspaceName.trim(),
          draft_tabs: clean,
          published_at: nowIso
        })
        .eq('id', org.id);
      if (orgUpdateError) throw orgUpdateError;

      setOrg((current) => ({ ...current, published_at: nowIso }));
      setStatus(`Published live workspace (${clean.length} tab(s)). Extension endpoint ready at ${apiPreview}`);
    } catch (error: any) {
      setStatus(error?.message || 'Publish failed.');
    } finally {
      setLoading(false);
    }
  }

  if (sessionState === 'loading') {
    return <main><div className="card"><h1>Dock Admin</h1><p>Loading…</p></div></main>;
  }

  if (sessionState === 'signed_out') {
    return (
      <main>
        <div className="card">
          <h1>Dock Admin Login</h1>
          <p className="muted">Sign in with a magic link. After your first sign-in, attach your user UUID to an organization using the commented bootstrap SQL in <code>supabase-schema.sql</code>.</p>
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@henry.k12.va.us" />
          <div className="toolbar">
            <button onClick={sendMagicLink} disabled={loading || !email.trim()}>{loading ? 'Sending…' : 'Send Magic Link'}</button>
          </div>
          <p id="status" className="muted">{status}</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 16 }}>
          <div>
            <h1>Dock Admin Phase 2</h1>
            <p className="muted">Signed in as {userEmail || email}. This admin is scoped to one district via <code>profiles.organization_id</code>.</p>
          </div>
          <button className="secondary" onClick={signOut}>Sign Out</button>
        </div>

        <div className="grid2">
          <div>
            <label>Organization Name</label>
            <input value={org.name} onChange={(e) => setOrg((c) => ({ ...c, name: e.target.value }))} />
          </div>
          <div>
            <label>Organization Code</label>
            <input value={org.org_code} disabled />
          </div>
          <div>
            <label>Email Domain</label>
            <input value={org.email_domain} onChange={(e) => setOrg((c) => ({ ...c, email_domain: e.target.value }))} />
          </div>
          <div>
            <label>Plan</label>
            <input value={org.plan} onChange={(e) => setOrg((c) => ({ ...c, plan: e.target.value }))} />
          </div>
          <div>
            <label>Max Users</label>
            <input type="number" value={org.max_users} onChange={(e) => setOrg((c) => ({ ...c, max_users: Number(e.target.value) || 500 }))} />
          </div>
          <div>
            <label>Published Endpoint</label>
            <input value={apiPreview} disabled />
          </div>
        </div>

        <label>Draft Workspace Name</label>
        <input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />

        <div className="toolbar">
          <button onClick={saveDraft} disabled={loading}>{loading ? 'Working…' : 'Save Draft'}</button>
          <button onClick={publishWorkspace} disabled={loading}>{loading ? 'Working…' : 'Publish Live Workspace'}</button>
        </div>
        <p className="muted">{org.published_at ? `Live published at ${new Date(org.published_at).toLocaleString()}` : 'Nothing published yet.'}</p>

        <div className="tabGrid">
          {tabs.map((tab, index) => (
            <div className="tabCard" key={index}>
              <div className="row">
                <h3>Tab {index + 1}</h3>
                <div className="smallActions">
                  <button type="button" onClick={() => moveTab(index, -1)}>↑</button>
                  <button type="button" onClick={() => moveTab(index, 1)}>↓</button>
                  <button type="button" onClick={() => removeTab(index)}>✕</button>
                </div>
              </div>
              <label>Title</label>
              <input value={tab.title} onChange={(e) => updateTab(index, 'title', e.target.value)} placeholder="Tab title" />
              <label>URL</label>
              <input value={tab.url} onChange={(e) => updateTab(index, 'url', e.target.value)} placeholder="https://example.com" />
              <div className="iconTools">
                <div className={`iconPreview ${tab.icon_url ? 'hasImage' : ''}`}>
                  {tab.icon_url ? <img src={tab.icon_url} alt="Custom icon preview" /> : <div className="iconPreviewPlaceholder">No custom icon</div>}
                </div>
                <div className="iconControls">
                  <div className="buttonRow">
                    <button type="button" onClick={() => triggerIconPick(index)}>Upload Icon</button>
                    <button type="button" className="secondary" onClick={() => clearIcon(index)}>Clear Icon</button>
                  </div>
                  <input id={`icon-upload-${index}`} type="file" accept="image/*" hidden onChange={(e) => handleIconUpload(index, e.target.files?.[0] || null)} />
                  <p className="muted">Uploaded icons are stored with the draft and published to the live endpoint.</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="toolbar">
          <button onClick={addTab} className="secondary">Add Tab</button>
        </div>

        <p id="status" className="muted">{status}</p>
      </div>
    </main>
  );
}
