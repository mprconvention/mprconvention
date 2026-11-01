import bcrypt from "npm:bcryptjs@2.4.3";
import { authenticate, db, reply, corsHeaders } from "../_shared/auth.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const ctx = await authenticate(req); if ("error" in ctx) return reply({ error: ctx.error }, 401);
  if (ctx.user.role !== "admin") return reply({ error: "Administrator access required" }, 403);
  try {
    const b = await req.json(); const username = String(b.username ?? "").trim().toLowerCase(); const email = b.email ? String(b.email).trim().toLowerCase() : null;
    const full_name = String(b.full_name ?? "").trim(); const password = String(b.password ?? ""); const role = String(b.role ?? "staff");
    const perms = Array.isArray(b.permissions) ? b.permissions : [];
    if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username) || !full_name || password.length < 12 || password.length > 200 || !["manager","staff","viewer"].includes(role)) return reply({ error: "Invalid username, name, password (minimum 12 characters), or role" }, 400);
    const { data: user, error } = await db.from("mpr_users").insert({ username, email, full_name, role, password_hash: bcrypt.hashSync(password, 12), is_active: true, must_change_password: true }).select("id,username,email,full_name,role,is_active").single();
    if (error) return reply({ error: error.code === "23505" ? "Username or email already exists" : error.message }, 400);
    const validModules = ["dashboard","calendar","bookings","calendar_blocks","customers","venues","auspicious_dates","users","reports","lovs"];
    const validActions = ["view","create","edit","delete"];
    const rows = perms.filter((p: any) => validModules.includes(p.module) && validActions.includes(p.action)).map((p: any) => ({ user_id: user.id, module: p.module, action: p.action, granted_by: ctx.user.id }));
    if (rows.length) { const { error: pe } = await db.from("user_permissions").insert(rows); if (pe) throw pe; }
    return reply({ user, message: "User created. They must change the temporary password after first login." }, 201);
  } catch (e) { console.error("admin-create-user failed", e); return reply({ error: "Unable to create user" }, 500); }
});
