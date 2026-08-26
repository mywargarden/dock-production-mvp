const HEX = /^#[0-9a-f]{6}$/i;
const STYLE_ID = 'dock-managed-dynamic-theme-style';
let config = null;
let lastAdminActive = null;

function validColor(v, fallback){ const s=String(v||'').trim(); return HEX.test(s)?s:fallback; }
function clamp(v,min,max,fallback){ const n=Number(v); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback; }
function safeImage(v){ const s=String(v||'').trim(); return /^(https?:\/\/|data:image\/)/i.test(s)?s:''; }
function cssUrl(v){ return String(v||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"'); }

async function loadManagedTheme(){
  try{
    const stored = await chrome.storage.local.get(['dockOrg']);
    const configUrl = String(stored?.dockOrg?.configUrl||'').trim();
    if(!/^https?:\/\//i.test(configUrl)) return null;
    const res = await fetch(configUrl,{cache:'no-store'});
    if(!res.ok) return null;
    return await res.json();
  }catch{return null;}
}

function adminIsActive(){
  return !!document.querySelector('.groupPillWrap[data-group-id="__admin__"] .groupPill.active');
}

function clearTheme(){
  document.body.classList.remove('managedDynamicThemeActive');
  document.documentElement.classList.remove('managedDynamicThemeActive');
  document.getElementById(STYLE_ID)?.remove();
}

function applyTheme(){
  const active = adminIsActive();
  if(!active){ clearTheme(); return; }
  const branding=config?.workspace?.branding||{};
  const t=branding.dynamicTheme;
  if(!t||typeof t!=='object'){ clearTheme(); return; }

  const bg=validColor(t.background,'#f4f8fc');
  const fg=validColor(t.foreground,'#14263a');
  const muted=validColor(t.muted,'#607286');
  const primary=validColor(t.primary,'#2b8c8f');
  const primaryText=validColor(t.primaryText,'#ffffff');
  const card=validColor(t.card,'#ffffff');
  const border=validColor(t.border,'#d7e1eb');
  const radius=clamp(t.radius,4,28,16);
  const opacity=clamp(t.cardOpacity,.45,1,.88);
  const scene=safeImage(t.sceneImageUrl);
  const districtBg=safeImage(branding.districtBackgroundUrl);
  const mode=String(t.backgroundMode||'color');
  const gradientEnd=validColor(t.gradientEnd,'#dcecf8');
  const bodyBackground = districtBg ? bg : mode==='image'&&scene ? `${bg} url("${cssUrl(scene)}") center/cover fixed no-repeat` : mode==='gradient' ? `linear-gradient(135deg,${bg},${gradientEnd})` : bg;
  const shadow=String(t.shadow||'soft');
  const shadowCss=shadow==='none'?'none':shadow==='deep'?'0 18px 42px rgba(10,28,48,.20)':shadow==='medium'?'0 12px 30px rgba(10,28,48,.14)':'0 8px 22px rgba(10,28,48,.09)';

  let style=document.getElementById(STYLE_ID);
  if(!style){style=document.createElement('style');style.id=STYLE_ID;document.head.appendChild(style);}
  style.textContent=`
    body.managedDynamicThemeActive{--bg:${bg};--fg:${fg};--muted:${muted};--primary:${primary};--primaryText:${primaryText};--card:${card};--border:${border};background:${bodyBackground}!important;color:${fg}!important}
    body.managedDynamicThemeActive .header,body.managedDynamicThemeActive .groupBar{background:color-mix(in srgb,${bg} 90%,transparent)!important;border-color:${border}!important}
    body.managedDynamicThemeActive .card,body.managedDynamicThemeActive .empty,body.managedDynamicThemeActive .menuPanel{background:color-mix(in srgb,${card} ${Math.round(opacity*100)}%,transparent)!important;border-color:${border}!important;border-radius:${radius}px!important;box-shadow:${shadowCss}!important;color:${fg}!important}
    body.managedDynamicThemeActive .muted,body.managedDynamicThemeActive .url{color:${muted}!important}
    body.managedDynamicThemeActive .actionBtn,body.managedDynamicThemeActive .groupPill:not(.active),body.managedDynamicThemeActive .row button:not(.danger){background:${primary}!important;color:${primaryText}!important}
  `;
  document.body.classList.add('managedDynamicThemeActive');
  document.documentElement.classList.add('managedDynamicThemeActive');
}

async function init(){
  config=await loadManagedTheme();
  applyTheme();
  const observer=new MutationObserver(()=>{
    const active=adminIsActive();
    if(active!==lastAdminActive){lastAdminActive=active;applyTheme();}
  });
  const pills=document.getElementById('groupPills');
  if(pills) observer.observe(pills,{subtree:true,attributes:true,childList:true,attributeFilter:['class']});
  document.addEventListener('click',()=>setTimeout(applyTheme,0),true);
  window.addEventListener('focus',async()=>{config=await loadManagedTheme();applyTheme();});
}

init();
