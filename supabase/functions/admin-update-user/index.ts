import { authenticate, db, reply, corsHeaders } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const ctx = await authenticate(req);
  if ("error" in ctx) return reply({ error: ctx.error }, ctx.status ?? 401);
  if (ctx.user.role !== "admin" || ctx.user.must_change_password) {
    return reply({ error: "Administrator access required" }, 403);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.user_id !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.user_id)) {
    return reply({ error: "Valid user ID required" }, 400);
  }
  const { error } = await db.rpc("mpr_manage_user", {
    p_actor: ctx.user.id,
    p_target: body.user_id,
    p_changes: { role: body.role, is_active: body.is_active, permissions: body.permissions },
  });
  if (!error) return reply({ ok: true });
  if (error.code === "P0002") return reply({ error: error.message }, 404);
  if (error.code === "42501") return reply({ error: error.message }, 403);
  if (["22023", "23502", "23514"].includes(error.code)) {
    return reply({ error: "Invalid role, activation status or permissions" }, 400);
  }
  console.error("admin-update-user failed", error.code);
  return reply({ error: "Unable to update user" }, 500);
});
