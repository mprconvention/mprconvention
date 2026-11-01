import type { SupabaseClient } from "@supabase/supabase-js";
import { mprInvoke } from "./mprAuth";
export type MprPermission = {module:string;action:"view"|"create"|"edit"|"delete"};
export async function listMprUsers(s:SupabaseClient){return mprInvoke<{users:any[]}>(s,"admin-list-users",{});}
export async function createMprUser(s:SupabaseClient,input:{username:string;email?:string|null;full_name:string;password:string;role:"manager"|"staff"|"viewer";permissions:MprPermission[]}){return mprInvoke(s,"admin-create-user",input);}
export async function updateMprUser(s:SupabaseClient,input:{user_id:string;role:"manager"|"staff"|"viewer";is_active:boolean;permissions:MprPermission[]}){return mprInvoke(s,"admin-update-user",input);}
