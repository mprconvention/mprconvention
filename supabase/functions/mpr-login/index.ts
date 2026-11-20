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
    const { data, error } = await db.rpc("mpr_issue_session", {
      p_actor: user.id, p_expected_hash: user.password_hash, p_token_hash: await sha256(token), p_expires: expires,
    });
    if (error?.code === "42501") return reply({ error: "Invalid login or password" }, 401);
    if (error) throw error;
    return reply({ token, expires_at: expires, ...data });
  } catch (e) { console.error("mpr-login failed", e); return reply({ error: "Login service unavailable" }, 500); }
});
