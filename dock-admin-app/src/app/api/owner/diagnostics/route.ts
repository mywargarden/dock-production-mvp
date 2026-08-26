export const dynamic='force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOwnerDistricts, normalizeDomain, normalizeEmail, requireOwner } from '@/lib/ownerServer'

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
        const status=match.organization?.license_status
        resolution={domain,email:email||null,matched:true,district:match.organization?.name,orgCode:match.organization?.org_code,licenseStatus:status,access:['suspended','expired'].includes(status)?'BLOCKED':status==='past_due'?'GRACE':'ALLOWED',profileStatus:profile?.status||null,outsideDomainException:!!allowed}
      }else resolution={domain,email:email||null,matched:false,access:'NO DISTRICT MATCH'}
    }
    const workspaceHealthy=districts.filter((d:any)=>d.publishedWorkspace).length
    const verifiedDomains=districts.filter((d:any)=>d.domains?.some((x:any)=>x.status==='verified')).length
    const billingConnected=districts.filter((d:any)=>d.billing).length
    const outdated=districts.flatMap((d:any)=>(d.installations||[]).filter((x:any)=>d.organization?.minimum_extension_version&&x.extension_version&&x.extension_version<d.organization.minimum_extension_version).map((x:any)=>({district:d.organization?.name,email:x.email,version:x.extension_version,minimum:d.organization.minimum_extension_version})))
    const report={checkedAt:new Date().toISOString(),districtCount:districts.length,database:'healthy',authentication:'healthy',workspaceHealthy,verifiedDomains,billingConnected,installationReports:districts.reduce((n:number,d:any)=>n+(d.installations?.length||0),0),outdatedInstallations:outdated.length,resolution}
    return NextResponse.json({ok:true,report,outdated})
  }catch(error:any){return NextResponse.json({error:error?.message||'Diagnostics failed.'},{status:400})}
}
