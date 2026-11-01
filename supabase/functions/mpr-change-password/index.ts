import bcrypt from "npm:bcryptjs@2.4.3";
import { authenticate, db, reply, corsHeaders } from "../_shared/auth.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const ctx = await authenticate(req); if ("error" in ctx) return reply({ error: ctx.error }, 401);
  try {
    const b = await req.json(); const current = String(b.current_password ?? ""); const next = String(b.new_password ?? "");
    if (next.length < 12 || next.length > 200) return reply({ error: "New password must be at least 12 characters" }, 400);
    const { data: row, error } = await db.from("mpr_users").select("password_hash").eq("id", ctx.user.id).single();
    if (error || !row || !bcrypt.compareSync(current, row.password_hash)) return reply({ error: "Current password is incorrect" }, 401);
    const { error: updateError } = await db.from("mpr_users").update({ password_hash: bcrypt.hashSync(next, 12), must_change_password: false }).eq("id", ctx.user.id);
    if (updateError) throw updateError;
    await db.from("mpr_sessions").delete().eq("user_id", ctx.user.id);
    return reply({ ok: true, message: "Password changed. Please log in again." });
  } catch (e) { console.error("mpr-change-password failed", e); return reply({ error: "Unable to change password" }, 500); }
});
