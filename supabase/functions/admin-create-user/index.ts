import bcrypt from "npm:bcryptjs@2.4.3";
import { authenticate, db, reply, corsHeaders } from "../_shared/auth.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const ctx = await authenticate(req); if ("error" in ctx) return reply({ error: ctx.error }, ctx.status ?? 401);
  if (ctx.user.role !== "admin" || ctx.user.must_change_password) return reply({ error: "Administrator access required" }, 403);
  try {
    const b = await req.json(); const username = String(b.username ?? "").trim().toLowerCase(); const email = b.email ? String(b.email).trim().toLowerCase() : null;
    const full_name = String(b.full_name ?? "").trim(); const password = String(b.password ?? ""); const role = String(b.role ?? "staff");
    if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username) || !full_name || password.length < 12 || password.length > 200 || !["manager","staff","viewer"].includes(role)) return reply({ error: "Invalid username, name, password (minimum 12 characters), or role" }, 400);
    const { data: user, error } = await db.rpc("mpr_manage_user", {
      p_actor: ctx.user.id, p_target: null,
      p_changes: { username, email, full_name, role, password_hash: bcrypt.hashSync(password, 12), permissions: b.permissions },
    });
    if (error?.code === "23505") return reply({ error: "Username or email already exists" }, 409);
    if (error?.code === "42501") return reply({ error: error.message }, 403);
    if (error && ["22023", "23502", "23514"].includes(error.code)) return reply({ error: "Invalid account settings or permissions" }, 400);
    if (error) throw error;
    return reply({ user, message: "User created. They must change the temporary password after first login." }, 201);
  } catch (e) { console.error("admin-create-user failed", e); return reply({ error: "Unable to create user" }, 500); }
});
