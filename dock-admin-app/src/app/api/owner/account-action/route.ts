export const dynamic='force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOwnerDistricts, normalize, requireOwner } from '@/lib/ownerServer'

const ACTIONS=new Set(['suspend','reactivate','archive'])

export async function POST(request:NextRequest){
  try{
    const auth=await requireOwner(request);if('error' in auth)return auth.error
    const body=await request.json()
    const organizationId=normalize(body?.organizationId)
    const action=normalize(body?.action).toLowerCase()
    const reason=normalize(body?.reason)
    const confirmation=normalize(body?.confirmation)
    if(!organizationId||!ACTIONS.has(action))return NextResponse.json({error:'A valid organization and account action are required.'},{status:400})
    if(reason.length<5)return NextResponse.json({error:'Enter a reason for this account action.'},{status:400})
    if(confirmation!=='CONFIRM')return NextResponse.json({error:'Type CONFIRM to authorize this account action.'},{status:400})

    const {data:org,error:readError}=await auth.service.from('organizations').select('*').eq('id',organizationId).maybeSingle()
    if(readError)throw readError
    if(!org)return NextResponse.json({error:'District not found.'},{status:404})

    const now=new Date().toISOString()
    const update:any={updated_at:now}
    if(action==='suspend'){
      update.license_status='suspended'
      update.suspended_at=now
    }else if(action==='reactivate'){
      update.license_status=org.license_status==='expired'?'active':'active'
      update.suspended_at=null
      if(org.customer_lifecycle==='archived')update.customer_lifecycle='active'
      update.archived_at=null
    }else if(action==='archive'){
      update.customer_lifecycle='archived'
      update.archived_at=now
    }

    const {data:next,error:updateError}=await auth.service.from('organizations').update(update).eq('id',organizationId).select('*').single()
    if(updateError)throw updateError
    await auth.service.from('audit_logs').insert({
      organization_id:organizationId,
      actor_email:auth.ownerEmail,
      action:`owner_${action}_customer`,
      target_type:'organization',
      target_id:organizationId,
      details:{reason,previousLicenseStatus:org.license_status,nextLicenseStatus:next.license_status,previousLifecycle:org.customer_lifecycle,nextLifecycle:next.customer_lifecycle}
    }).throwOnError()

    return NextResponse.json({ok:true,organization:next,districts:await loadOwnerDistricts(auth.service)})
  }catch(error:any){return NextResponse.json({error:error?.message||'Could not complete account action.'},{status:400})}
}
