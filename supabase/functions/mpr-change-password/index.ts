import bcrypt from "npm:bcryptjs@2.4.3";
import { authenticate, db, reply, corsHeaders } from "../_shared/auth.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const ctx = await authenticate(req); if ("error" in ctx) return reply({ error: ctx.error }, ctx.status ?? 401);
  try {
    const b = await req.json(); const current = String(b.current_password ?? ""); const next = String(b.new_password ?? "");
    if (next.length < 12 || next.length > 200) return reply({ error: "New password must be at least 12 characters" }, 400);
    const { data: row, error } = await db.from("mpr_users").select("password_hash").eq("id", ctx.user.id).single();
    if (error || !row || !bcrypt.compareSync(current, row.password_hash)) return reply({ error: "Current password is incorrect" }, 401);
    const { error: updateError } = await db.rpc("mpr_replace_password", {
      p_actor: ctx.user.id, p_session: ctx.sessionId, p_expected_hash: row.password_hash, p_new_hash: bcrypt.hashSync(next, 12),
    });
    if (updateError?.code === "42501") return reply({ error: updateError.message }, 401);
    if (updateError) throw updateError;
    return reply({ ok: true, message: "Password changed. Please log in again." });
  } catch (e) { console.error("mpr-change-password failed", e); return reply({ error: "Unable to change password" }, 500); }
});
