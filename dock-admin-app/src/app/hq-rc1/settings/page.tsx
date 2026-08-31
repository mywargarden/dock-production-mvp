'use client'

import { useEffect, useState } from 'react'
import { getAccessToken, getUser, signIn } from '@/lib/auth'

type Settings=Record<string,any>

const booleanKeys=['allow_user_theme_override','allow_admin_branding','notify_payment_failed','notify_trial_ending','notify_renewal','notify_suspension','notify_seat_threshold','notify_workspace_failure','notify_incident','notify_outdated_version','notify_new_admin','maintenance_mode','emergency_restrictions']

export default function Rc1Settings(){
  const [user,setUser]=useState<any>(null)
  const [settings,setSettings]=useState<Settings>({})
  const [status,setStatus]=useState('Loading owner settings…')
  const [meta,setMeta]=useState<any>({})
  const [busy,setBusy]=useState(false)

  useEffect(()=>{(async()=>{const u=await getUser();setUser(u);if(u)await load()})()},[])

  async function authFetch(url:string,opts:any={}){const token=await getAccessToken();if(!token)throw new Error('Sign in again.');return fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:`Bearer ${token}`}})}
  async function load(){try{const r=await authFetch('/api/owner/settings',{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error||'Could not load settings.');setSettings(j.settings||{});setMeta(j);setStatus('Owner settings loaded.')}catch(e:any){setStatus(e.message)}}
  function patch(k:string,v:any){setSettings(c=>({...c,[k]:v}))}
  async function save(action='save'){
    setBusy(true)
    try{
      let reason='',confirmation=''
      if(action==='safety'){
        reason=window.prompt('Reason for changing product-wide safety flags:')||''
        confirmation=window.prompt('Type CONFIRM to change product-wide safety flags:')||''
      }
      const r=await authFetch('/api/owner/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,settings,reason,confirmation})})
      const j=await r.json();if(!r.ok)throw new Error(j.error||'Save failed.')
      setSettings(j.settings||settings);setMeta(j);setStatus(`Saved. Changed: ${(j.changed||[]).join(', ')||'none'}.`)
    }catch(e:any){setStatus(e.message)}finally{setBusy(false)}
  }

  if(!user)return <main className="hq2SignIn"><section className="hq2SignInCard"><h1>Dock RC1 Settings</h1><p>Owner authentication required.</p><button onClick={signIn}>Sign in</button></section></main>

  return <main className="hq2Content" style={{maxWidth:1100,margin:'0 auto'}}>
    <section className="hq2Hero"><div><div className="hq2Eyebrow">Dock 1.0 RC1</div><h1>Owner Settings</h1><p>Launch-critical defaults, support routing, notifications and safety flags.</p></div></section>
    <section className="hq2Card"><strong>{status}</strong>{meta.updated_at&&<div className="hq2Sub" style={{marginTop:6}}>Last updated {new Date(meta.updated_at).toLocaleString()} by {meta.updated_by||'unknown'}</div>}</section>

    <section className="hq2Card"><h2>Defaults</h2><div className="hq2FormGrid">
      {[['Trial days','default_trial_days','number'],['Grace days','default_grace_days','number'],['Default seats','default_seats','number'],['Seat warning %','seat_threshold_percent','number'],['Trial notice days','trial_notice_days','number'],['Renewal notice days','renewal_notice_days','number'],['Default plan','default_plan','text'],['Minimum extension version','default_minimum_version','text'],['Default theme','default_theme','text'],['Support email','support_email','email'],['Billing email','billing_email','email'],['Notification email','notification_email','email'],['Support URL','support_url','text']].map(([label,key,type])=><div className="hq2Field" key={key}><label>{label}</label><input type={type} value={settings[key]??''} onChange={e=>patch(key,type==='number'?Number(e.target.value):e.target.value)}/></div>)}
    </div><div className="hq2Inline" style={{marginTop:14}}><button className="hq2Primary" disabled={busy} onClick={()=>save('save')}>Save settings</button></div></section>

    <section className="hq2Grid2">
      <div className="hq2Card"><h2>Permissions & notifications</h2>{booleanKeys.filter(k=>!['maintenance_mode','emergency_restrictions'].includes(k)).map(k=><label className="hq2Check" key={k}><input type="checkbox" checked={settings[k]===true} onChange={e=>patch(k,e.target.checked)}/>{k.replace(/_/g,' ')}</label>)}<div className="hq2Inline" style={{marginTop:14}}><button className="hq2Primary" disabled={busy} onClick={()=>save('save')}>Save settings</button></div></div>
      <div className="hq2Card"><h2>Safety flags</h2><p>These are global product controls and require explicit confirmation.</p>{['maintenance_mode','emergency_restrictions'].map(k=><label className="hq2Check" key={k}><input type="checkbox" checked={settings[k]===true} onChange={e=>patch(k,e.target.checked)}/>{k.replace(/_/g,' ')}</label>)}<div className="hq2Inline" style={{marginTop:14}}><button className="hq2Danger" disabled={busy} onClick={()=>save('safety')}>Apply safety flags</button></div></div>
    </section>
  </main>
}
