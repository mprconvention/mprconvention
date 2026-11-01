import type { SupabaseClient } from '@supabase/supabase-js';
export type MprUser={id:string;username:string;email:string|null;full_name:string;role:string;is_active:boolean;must_change_password:boolean};
const TOKEN_KEY='mpr_session_token';
let sessionToken:string|null=typeof sessionStorage!=='undefined'?sessionStorage.getItem(TOKEN_KEY):null;
export function getMprToken(){return sessionToken;}
export function setMprToken(token:string|null){sessionToken=token;if(typeof sessionStorage!=='undefined'){if(token)sessionStorage.setItem(TOKEN_KEY,token);else sessionStorage.removeItem(TOKEN_KEY);}}
export async function mprLogin(s:SupabaseClient,identifier:string,password:string){const {data,error}=await s.functions.invoke('mpr-login',{body:{identifier,password}});if(error)throw error;if(!data?.token)throw new Error(data?.error??'Login failed');setMprToken(data.token);return data as {token:string;user:MprUser;permissions:{module:string;action:string}[];expires_at:string};}
export async function mprLogout(s:SupabaseClient){try{if(sessionToken)await s.functions.invoke('mpr-logout',{headers:{Authorization:`Bearer ${sessionToken}`}});}finally{setMprToken(null);}}
export async function mprInvoke<T>(s:SupabaseClient,name:string,body:unknown):Promise<T>{if(!sessionToken)throw new Error('Your MPR session has expired. Please log in again.');const {data,error}=await s.functions.invoke(name,{body,headers:{Authorization:`Bearer ${sessionToken}`}});if(error)throw error;if(data?.error)throw new Error(data.error);return data as T;}
export async function mprChangePassword(s:SupabaseClient,current_password:string,new_password:string){return mprInvoke(s,'mpr-change-password',{current_password,new_password});}
