import { authenticate, db, reply, corsHeaders } from "../_shared/auth.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const ctx = await authenticate(req); if ("error" in ctx) return reply({ error: ctx.error }, 401);
  if (ctx.user.role !== "admin") return reply({ error: "Administrator access required" }, 403);
  try {
    const b = await req.json(); const id = String(b.user_id ?? ""); const role = String(b.role ?? "staff");
    if (!id || !["manager","staff","viewer"].includes(role)) return reply({ error: "Invalid user or role" }, 400);
    const { data: target } = await db.from("mpr_users").select("id,role").eq("id", id).maybeSingle();
    if (!target) return reply({ error: "User not found" }, 404);
    if (target.role === "admin") return reply({ error: "Administrator accounts can only be changed through a controlled SQL procedure" }, 403);
    const { error } = await db.from("mpr_users").update({ role, is_active: Boolean(b.is_active) }).eq("id", id);
    if (error) throw error;
    await db.from("mpr_sessions").delete().eq("user_id", id);
    await db.from("user_permissions").delete().eq("user_id", id);
    const perms = Array.isArray(b.permissions) ? b.permissions : [];
    const modules = ["dashboard","calendar","bookings","calendar_blocks","customers","venues","auspicious_dates","users","reports","lovs"];
    const actions = ["view","create","edit","delete"];
    const rows = perms.filter((p: any) => modules.includes(p.module) && actions.includes(p.action)).map((p: any) => ({ user_id: id, module: p.module, action: p.action, granted_by: ctx.user.id }));
    if (rows.length) { const { error: pe } = await db.from("user_permissions").insert(rows); if (pe) throw pe; }
    return reply({ ok: true });
  } catch (e) { console.error("admin-update-user failed", e); return reply({ error: "Unable to update user" }, 500); }
});
