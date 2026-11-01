import { authenticate, db, reply, corsHeaders } from "../_shared/auth.ts";
Deno.serve(async (req) => { if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders }); const ctx = await authenticate(req); if ("error" in ctx) return reply({ ok: true }); await db.from("mpr_sessions").delete().eq("id", ctx.sessionId); return reply({ ok: true }); });
