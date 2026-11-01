import bcrypt from "npm:bcryptjs@2.4.3";
import { db, reply, sha256, makeToken, corsHeaders } from "../_shared/auth.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const identifier = String(body.identifier ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!identifier || !password || identifier.length > 254 || password.length > 200) return reply({ error: "Enter username/email and password" }, 400);
    let { data: user } = await db.from("mpr_users").select("id,username,email,full_name,role,is_active,must_change_password,password_hash")
      .eq("username", identifier).maybeSingle();
    if (!user) ({ data: user } = await db.from("mpr_users").select("id,username,email,full_name,role,is_active,must_change_password,password_hash")
      .eq("email", identifier).maybeSingle());
    if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) return reply({ error: "Invalid login or password" }, 401);
    const token = makeToken();
    const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const { error } = await db.from("mpr_sessions").insert({ user_id: user.id, token_hash: await sha256(token), expires_at: expires });
    if (error) throw error;
    await db.from("mpr_users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
    const { data: permissions } = await db.from("user_permissions").select("module,action").eq("user_id", user.id);
    delete user.password_hash;
    return reply({ token, expires_at: expires, user, permissions: permissions ?? [] });
  } catch (e) { console.error("mpr-login failed", e); return reply({ error: "Login service unavailable" }, 500); }
});
