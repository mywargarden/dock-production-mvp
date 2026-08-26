export const dynamic='force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOwnerDistricts, normalizeDomain, normalizeEmail, requireOwner } from '@/lib/ownerServer'

function versionParts(value:string){return String(value||'').replace(/^v/i,'').split('.').map(x=>Number(x)||0)}
function versionLt(a:string,b:string){const aa=versionParts(a),bb=versionParts(b),n=Math.max(aa.length,bb.length);for(let i=0;i<n;i++){if((aa[i]||0)<(bb[i]||0))return true;if((aa[i]||0)>(bb[i]||0))return false}return false}
function check(key:string,label:string,status:'pass'|'warning'|'fail',summary:string,affected:number=0,recommendation=''){return {key,label,status,summary,affected,recommendation}}

export async function GET(request:NextRequest){
  try{
    const auth=await requireOwner(request);if('error' in auth)return auth.error
    const districts=await loadOwnerDistricts(auth.service)
    const url=new URL(request.url)
    const email=normalizeEmail(url.searchParams.get('email'))
    const domain=normalizeDomain(url.searchParams.get('domain')||(email.includes('@')?email.split('@')[1]:''))
    let resolution:any=null

    if(domain){
      const match=districts.find((d:any)=>d.domains?.some((x:any)=>x.status==='verified'&&(x.normalized_domain||x.domain)===domain)||d.organization?.email_domain===domain)
      if(match){
        const allowed=email?match.allowedUsers?.find((x:any)=>normalizeEmail(x.email)===email&&x.status!=='inactive'):null
        const profile=email?match.users?.find((x:any)=>normalizeEmail(x.email)===email):null
        const admin=email?match.admins?.find((x:any)=>normalizeEmail(x.email)===email&&x.status!=='disabled'):null
        const status=match.organization?.license_status
        const blockedByLicense=['suspended','expired'].includes(status)
        const blockedByProfile=profile?.status==='inactive'
        const permittedIdentity=!email||Boolean(profile||admin||allowed||email.endsWith(`@${domain}`))
        let access='ALLOWED',reason='Verified district domain and eligible identity.'
        if(blockedByLicense){access='BLOCKED';reason=`District license is ${status}.`}
        else if(blockedByProfile){access='BLOCKED';reason='User profile is inactive.'}
        else if(!permittedIdentity){access='BLOCKED';reason='Identity is not a district profile, admin, domain member, or allowed exception.'}
        else if(status==='past_due'){access='GRACE';reason='District is past due but remains inside its configured grace period.'}
        resolution={domain,email:email||null,matched:true,district:match.organization?.name,orgCode:match.organization?.org_code,licenseStatus:status,access,reason,profileStatus:profile?.status||null,role:profile?.role||admin?.role||null,isDistrictAdmin:!!admin,outsideDomainException:!!allowed,verifiedDomain:!!match.domains?.some((x:any)=>x.status==='verified'&&(x.normalized_domain||x.domain)===domain)}
      }else resolution={domain,email:email||null,matched:false,access:'BLOCKED',reason:'No verified Dock district matches this domain.'}
    }

    const workspaceMissing=districts.filter((d:any)=>!d.publishedWorkspace)
    const domainMissing=districts.filter((d:any)=>!d.domains?.some((x:any)=>x.status==='verified'))
    const billingMissing=districts.filter((d:any)=>['active','past_due'].includes(d.organization?.license_status)&&!d.billing)
    const licenseProblems=districts.filter((d:any)=>['past_due','suspended','expired'].includes(d.organization?.license_status))
    const themeMissing=districts.filter((d:any)=>!d.organization?.default_theme)
    const installCount=districts.reduce((n:number,d:any)=>n+(d.installations?.length||0),0)
    const outdated=districts.flatMap((d:any)=>(d.installations||[]).filter((x:any)=>d.organization?.minimum_extension_version&&x.extension_version&&versionLt(x.extension_version,d.organization.minimum_extension_version)).map((x:any)=>({district:d.organization?.name,orgCode:d.organization?.org_code,email:x.email,version:x.extension_version,minimum:d.organization.minimum_extension_version,lastSeen:x.last_seen_at})))

    const checks=[
      check('database','Database','pass',`Loaded ${districts.length} district record${districts.length===1?'':'s'} from Supabase.`),0,'No action required.'),
      check('authentication','Owner authentication','pass',`Authenticated owner session for ${auth.ownerEmail}.`,0,'No action required.'),
      check('district_resolution','District resolution',domainMissing.length?'warning':'pass',domainMissing.length?`${domainMissing.length} district${domainMissing.length===1?' has':'s have'} no verified domain.`:'Every district has a verified domain.',domainMissing.length,domainMissing.length?'Open Districts and verify the missing domain records.':'No action required.'),
      check('license','License enforcement',licenseProblems.length?'warning':'pass',licenseProblems.length?`${licenseProblems.length} district${licenseProblems.length===1?' needs':'s need'} license attention.`:'No suspended, expired, or past-due districts.',licenseProblems.length,licenseProblems.length?'Open Licensing & Billing and review the affected customers.':'No action required.'),
      check('workspace','Managed workspaces',workspaceMissing.length?'warning':'pass',workspaceMissing.length?`${workspaceMissing.length} district${workspaceMissing.length===1?' has':'s have'} no published workspace.`:'All districts have a published workspace.',workspaceMissing.length,workspaceMissing.length?'Open Workspaces or District Admin and publish the missing workspace.':'No action required.'),
      check('themes','Themes',themeMissing.length?'warning':'pass',themeMissing.length?`${themeMissing.length} district${themeMissing.length===1?' has':'s have'} no default theme.`:'Every district has a default theme assignment.',themeMissing.length,themeMissing.length?'Assign a theme from Branding or Theme Studio.':'No action required.'),
      check('billing','Billing integration',billingMissing.length?'warning':'pass',billingMissing.length?`${billingMissing.length} active/past-due district${billingMissing.length===1?' has':'s have'} no billing subscription record.`:'Billing records exist for all active/past-due districts.',billingMissing.length,billingMissing.length?'Connect or verify Stripe subscription data before relying on automatic enforcement.':'No action required.'),
      check('telemetry','Extension telemetry',outdated.length?'warning':installCount?'pass':'warning',outdated.length?`${outdated.length} installation${outdated.length===1?' is':'s are'} below the district minimum.`:installCount?`${installCount} installation report${installCount===1?'':'s'} received.`:'No extension installation telemetry has been received yet.',outdated.length,outdated.length?'Review Releases and update affected installations.':installCount?'No action required.':'Verify extension telemetry before enforcing version floors.'),
    ]

    const report={checkedAt:new Date().toISOString(),districtCount:districts.length,database:'healthy',authentication:'healthy',workspaceHealthy:districts.length-workspaceMissing.length,verifiedDomains:districts.length-domainMissing.length,billingConnected:districts.filter((d:any)=>d.billing).length,installationReports:installCount,outdatedInstallations:outdated.length,resolution,checks,summary:{pass:checks.filter(x=>x.status==='pass').length,warning:checks.filter(x=>x.status==='warning').length,fail:checks.filter(x=>x.status==='fail').length}}
    return NextResponse.json({ok:true,report,outdated})
  }catch(error:any){return NextResponse.json({error:error?.message||'Diagnostics failed.'},{status:400})}
}
