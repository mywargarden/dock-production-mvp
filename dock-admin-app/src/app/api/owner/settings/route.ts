export const dynamic='force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { normalize, normalizeEmail, requireOwner } from '@/lib/ownerServer'

const defaults={default_trial_days:30,default_grace_days:30,default_plan:'district',default_seats:500,default_minimum_version:'',default_theme:'dock-green',allow_user_theme_override:true,allow_admin_branding:true,support_email:'',billing_email:'',support_url:'',notification_email:'',seat_threshold_percent:85,trial_notice_days:14,renewal_notice_days:60,notify_payment_failed:true,notify_trial_ending:true,notify_renewal:true,notify_suspension:true,notify_seat_threshold:true,notify_workspace_failure:true,notify_incident:true,notify_outdated_version:true,notify_new_admin:true,maintenance_mode:false,emergency_restrictions:false}

function safeSettings(raw:any){
 const next:any={...defaults,...(raw||{})}
 next.default_trial_days=Math.max(0,Math.min(3650,Number(next.default_trial_days)||0))
 next.default_grace_days=Math.max(0,Math.min(365,Number(next.default_grace_days)||0))
 next.default_seats=Math.max(1,Math.min(1000000,Number(next.default_seats)||1))
 next.seat_threshold_percent=Math.max(1,Math.min(100,Number(next.seat_threshold_percent)||85))
 next.trial_notice_days=Math.max(0,Math.min(365,Number(next.trial_notice_days)||14))
 next.renewal_notice_days=Math.max(0,Math.min(365,Number(next.renewal_notice_days)||60))
 next.support_email=normalizeEmail(next.support_email)||''
 next.billing_email=normalizeEmail(next.billing_email)||''
 next.notification_email=normalizeEmail(next.notification_email)||next.support_email||''
 next.support_url=normalize(next.support_url)
 next.default_minimum_version=normalize(next.default_minimum_version)
 next.default_theme=normalize(next.default_theme)||'dock-green'
 next.default_plan=normalize(next.default_plan)||'district'
 for(const key of ['allow_user_theme_override','allow_admin_branding','notify_payment_failed','notify_trial_ending','notify_renewal','notify_suspension','notify_seat_threshold','notify_workspace_failure','notify_incident','notify_outdated_version','notify_new_admin','maintenance_mode','emergency_restrictions'])next[key]=next[key]===true
 return next
}

export async function GET(request:NextRequest){
 const auth=await requireOwner(request);if('error' in auth)return auth.error
 const {data,error}=await auth.service.from('owner_settings').select('settings,updated_at,updated_by').eq('id','global').maybeSingle()
 if(error)return NextResponse.json({error:error.message},{status:400})
 return NextResponse.json({ok:true,scope:'global',settings:safeSettings(data?.settings),updated_at:data?.updated_at||null,updated_by:data?.updated_by||null})
}

export async function POST(request:NextRequest){
 const auth=await requireOwner(request);if('error' in auth)return auth.error
 const body=await request.json();const action=normalize(body?.action)||'save'
 const {data:currentRow,error:readError}=await auth.service.from('owner_settings').select('settings').eq('id','global').maybeSingle()
 if(readError)return NextResponse.json({error:readError.message},{status:400})
 const current=safeSettings(currentRow?.settings)
 const next=safeSettings(body?.settings)

 if(action==='safety'){
   const changedMaintenance=current.maintenance_mode!==next.maintenance_mode
   const changedEmergency=current.emergency_restrictions!==next.emergency_restrictions
   if(changedMaintenance||changedEmergency){
     const confirmation=normalize(body?.confirmation)
     const reason=normalize(body?.reason)
     if(confirmation!=='CONFIRM')return NextResponse.json({error:'Type CONFIRM to change product-wide safety flags.'},{status:400})
     if(reason.length<5)return NextResponse.json({error:'A reason is required for product-wide safety changes.'},{status:400})
   }
 }

 const now=new Date().toISOString();const {error}=await auth.service.from('owner_settings').upsert({id:'global',settings:next,updated_by:auth.ownerEmail,updated_at:now},{onConflict:'id'})
 if(error)return NextResponse.json({error:error.message},{status:400})
 const changed=Object.keys(next).filter(k=>JSON.stringify(current[k])!==JSON.stringify(next[k]))
 await auth.service.from('audit_logs').insert({organization_id:null,actor_email:auth.ownerEmail,action:action==='safety'?'owner_update_safety_flags':'owner_update_settings',target_type:'owner_settings',target_id:'global',details:{changed,reason:action==='safety'?normalize(body?.reason)||null:null}})
 return NextResponse.json({ok:true,scope:'global',settings:next,updated_at:now,updated_by:auth.ownerEmail,changed})
}
