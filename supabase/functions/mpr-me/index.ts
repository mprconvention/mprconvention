import { authenticate, reply, corsHeaders } from "../_shared/auth.ts";
Deno.serve(async (req) => { if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders }); const ctx = await authenticate(req); if ("error" in ctx) return reply({ error: ctx.error }, 401); return reply({ user: ctx.user, permissions: ctx.permissions }); });
