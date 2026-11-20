import type { SupabaseClient } from '@supabase/supabase-js';
import { mprInvoke } from './mprAuth';
import type { RecordAudit } from "./recordAudit";
export type CalendarEntry={id:string;start_date:string;end_date:string;start_time:string|null;end_time:string|null;booking_mode:string;entry_type:"reserved"|"blocked";is_hold:boolean};
export type AuspiciousDate=RecordAudit & {id:string;date:string;title:string;category_code?:string;description?:string;region_code?:string};
export async function getActiveVenues(s:SupabaseClient){const r=await mprInvoke<{data:{id:string;venue_name:string;venue_code:string;timezone:string}[]}>(s,'mpr-api',{action:'get-active-venues'});return r.data??[];}
export async function getAvailability(s:SupabaseClient,venue_id:string,month:string){return mprInvoke<{entries:CalendarEntry[];auspicious:AuspiciousDate[]}>(s,'mpr-api',{action:'get-availability',venue_id,month});}
export type LovOption = { value_code: string; display_label: string; is_active?: boolean; extra_data?: { behavior?: string } };
export async function getLovValues(s:SupabaseClient,list_code:string,includeInactive = false){const r=await mprInvoke<{data:LovOption[]}>(s,'mpr-api',{action:'get-lov-values',list_code,include_inactive:includeInactive});return r.data??[];}

export async function getLovLabels(s: SupabaseClient, listCode: string) {
  const options = await getLovValues(s, listCode, true);
  return new Map(options.map(option => [option.value_code, option.display_label]));
}
