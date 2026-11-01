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
  const { data: session } = await db.from("mpr_sessions").select("id,user_id,expires_at")
    .eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!session) return { error: "Session is invalid or expired" } as const;
  const { data: user } = await db.from("mpr_users")
    .select("id,username,email,full_name,role,is_active,must_change_password")
    .eq("id", session.user_id).maybeSingle();
  if (!user?.is_active) return { error: "User account is inactive" } as const;
  await db.from("mpr_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", session.id);
  const { data: permissions } = await db.from("user_permissions").select("module,action").eq("user_id", user.id);
  return { user, permissions: permissions ?? [], sessionId: session.id } as const;
}
export function allowed(ctx: { user: any; permissions: any[] }, module: string, action: string) {
  if (ctx.user.role === "admin") return true;
  if (ctx.user.role === "manager" && module === "auspicious_dates" && ["view", "create", "edit", "delete"].includes(action)) return true;
  return ctx.permissions.some((p) => p.module === module && p.action === action);
}
export function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
