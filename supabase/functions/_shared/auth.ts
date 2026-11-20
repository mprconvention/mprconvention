import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin":
    Deno.env.get("MPR_ALLOWED_ORIGIN") ?? "https://invalid.local",

  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",

  "Access-Control-Allow-Methods": "POST, OPTIONS",

  "Vary": "Origin",
};
export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
export function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function bearer(req: Request) {
  const h = req.headers.get("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}
export async function authenticate(req: Request) {
  const token = bearer(req);
  if (!token) return { error: "Missing MPR session token" } as const;
  const tokenHash = await sha256(token);
  const { data: session, error } = await db.from("mpr_sessions")
    .select("id,user:mpr_users!mpr_sessions_user_id_fkey(id,username,email,full_name,role,is_active,must_change_password,permissions:user_permissions!user_permissions_user_mpr_fk(module,action))")
    .eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) {
    console.error("MPR session lookup failed", error.code);
    return { error: "Session service unavailable", status: 503 } as const;
  }
  const account = Array.isArray(session?.user) ? session.user[0] : session?.user;
  if (!session || !account?.is_active) return { error: "Session is invalid or expired" } as const;
  const { permissions, ...user } = account;
  const { data: touched, error: touchError } = await db.from("mpr_sessions")
    .update({ last_seen_at: new Date().toISOString(), updated_by: user.id })
    .eq("id", session.id).select("id").maybeSingle();
  if (touchError) return { error: "Session service unavailable", status: 503 } as const;
  if (!touched) return { error: "Session is invalid or expired" } as const;
  return { user, permissions: permissions ?? [], sessionId: session.id } as const;
}
export function allowed(ctx: { user: any; permissions: any[] }, module: string, action: string) {
  if (ctx.user.must_change_password) return false;
  if (ctx.user.role === "admin") return true;
  if (["users", "lovs"].includes(module) || (ctx.user.role === "viewer" && action !== "view")) return false;
  if (ctx.user.role === "manager" && module === "auspicious_dates" && ["view", "create", "edit", "delete"].includes(action)) return true;
  return ctx.permissions.some((p) => p.module === module && p.action === action);
}
export function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
