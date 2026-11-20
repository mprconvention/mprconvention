import { recordAudit } from "../_shared/recordAudit.ts";
import { authenticate, db, reply, corsHeaders } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const ctx = await authenticate(req);
  if ("error" in ctx) return reply({ error: ctx.error }, ctx.status ?? 401);
  if (ctx.user.role !== "admin" || ctx.user.must_change_password) {
    return reply({ error: "Administrator access required" }, 403);
  }
  const { data, error } = await db.from("mpr_users")
    .select(`id,username,email,full_name,role,is_active,last_login_at,
      permissions:user_permissions!user_permissions_user_mpr_fk(module,action),${recordAudit("mpr_users")}`)
    .order("created_at", { ascending: false });
  if (error) return reply({ error: "Unable to list users" }, 500);
  return reply({ users: data ?? [] });
});
