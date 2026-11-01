import type { SupabaseClient } from '@supabase/supabase-js';
import { mprInvoke } from './mprAuth';
export type CalendarEntry={id:string;start_date:string;end_date:string;start_time?:string|null;end_time?:string|null;booking_mode?:string;event_name?:string|null;block_reason_code?:string|null;status?:string};
export type AuspiciousDate={id:string;date:string;title:string;category_code?:string;description?:string;region_code?:string};
export async function getActiveVenues(s:SupabaseClient){const r=await mprInvoke<{data:{id:string;venue_name:string;venue_code:string;timezone:string}[]}>(s,'mpr-api',{action:'get-active-venues'});return r.data??[];}
export async function getThreeCalendars(s:SupabaseClient,venue_id:string,month:string){return mprInvoke<{reserved:CalendarEntry[];blocked:CalendarEntry[];auspicious:AuspiciousDate[]}>(s,'mpr-api',{action:'get-three-calendars',venue_id,month});}
export async function getLovValues(s:SupabaseClient,list_code:string){const r=await mprInvoke<{data:any[]}>(s,'mpr-api',{action:'get-lov-values',list_code});return r.data??[];}
