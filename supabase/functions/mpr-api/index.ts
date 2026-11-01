import { authenticate, allowed, db, reply, corsHeaders } from "../_shared/auth.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const ctx = await authenticate(req); if ("error" in ctx) return reply({ error: ctx.error }, 401);
  try {
    const b = await req.json(); const action = String(b.action ?? "");
    if (action === "get-active-venues") {
      if (!(allowed(ctx,"venues","view") || allowed(ctx,"calendar","view"))) return reply({ error: "Permission denied" },403);
      const { data, error } = await db.from("venues").select("id,venue_name,venue_code,timezone").eq("is_active",true).order("venue_name"); if(error) throw error; return reply({ data: data ?? [] });
    }
    if (action === "get-lov-values") {
      const code = String(b.list_code ?? ""); const { data: list, error: le } = await db.from("lov_lists").select("id").eq("list_code",code).eq("is_active",true).maybeSingle(); if(le) throw le; if(!list) return reply({data:[]});
      const { data, error } = await db.from("lov_values").select("value_code,display_label,description,extra_data,sort_order").eq("list_id",list.id).eq("is_active",true).order("sort_order"); if(error) throw error; return reply({data:data ?? []});
    }
    if (action === "get-three-calendars") {
      const venueId=String(b.venue_id ?? ""), month=String(b.month ?? ""); if(!/^[0-9a-f-]{36}$/i.test(venueId) || !/^\d{4}-\d{2}$/.test(month)) return reply({error:"Invalid venue or month"},400);
      if(!allowed(ctx,"calendar","view")) return reply({error:"Calendar permission required"},403);
      const [y,m]=month.split("-").map(Number); const start=`${month}-01`; const last=new Date(Date.UTC(y,m,0)).getUTCDate(); const end=`${month}-${String(last).padStart(2,"0")}`;
      const [reserved,blocked,auspicious] = await Promise.all([
        db.from("calendar_entries").select("*").eq("venue_id",venueId).eq("entry_type","reserved").eq("status","active").lte("start_date",end).gte("end_date",start).order("starts_at"),
        db.from("calendar_entries").select("*").eq("venue_id",venueId).eq("entry_type","blocked").eq("status","active").lte("start_date",end).gte("end_date",start).order("starts_at"),
        db.from("auspicious_dates").select("id,date,title,category_code,description,region_code").eq("is_active",true).gte("date",start).lte("date",end).order("date")
      ]); if(reserved.error||blocked.error||auspicious.error) throw new Error("Calendar query failed");
      const canSeeAuspicious = allowed(ctx,"auspicious_dates","view");
      return reply({reserved:reserved.data??[],blocked:blocked.data??[],auspicious:canSeeAuspicious?(auspicious.data??[]):[]});
    }
    if (action === "list-lov-lists") {
      const { data, error } = await db.from("lov_lists").select("id,list_code,list_name,description").eq("is_active",true).order("sort_order").order("list_name");
      if (error) throw error; return reply({data:data??[]});
    }
    if (action === "list-lov-values") {
      const listId=String(b.list_id??""); if(!listId) return reply({error:"List is required"},400);
      const {data,error}=await db.from("lov_values").select("id,value_code,display_label,description,sort_order,is_active,is_default").eq("list_id",listId).order("sort_order").order("display_label");
      if(error) throw error; return reply({data:data??[]});
    }
    if (action === "add-lov-value") {
      if(ctx.user.role!=="admin") return reply({error:"Administrator access required"},403);
      const listId=String(b.list_id??""), code=String(b.value_code??""), label=String(b.display_label??"").trim();
      if(!listId || !/^[a-z][a-z0-9_]{0,62}$/.test(code) || !label) return reply({error:"Invalid list, code or label"},400);
      const {data,error}=await db.from("lov_values").insert({list_id:listId,value_code:code,display_label:label,description:b.description||null,sort_order:Number(b.sort_order??0),is_active:true,created_by:ctx.user.id,updated_by:ctx.user.id}).select("id").single();
      if(error) throw error; return reply({data});
    }
    if (action === "update-lov-value") {
      if(ctx.user.role!=="admin") return reply({error:"Administrator access required"},403);
      const id=String(b.id??""); const patch:any={updated_by:ctx.user.id};
      if(typeof b.display_label==="string") patch.display_label=b.display_label.trim();
      if(typeof b.description==="string" || b.description===null) patch.description=b.description;
      if(typeof b.is_active==="boolean") patch.is_active=b.is_active;
      if(Number.isInteger(b.sort_order)) patch.sort_order=b.sort_order;
      const {error}=await db.from("lov_values").update(patch).eq("id",id); if(error) throw error; return reply({ok:true});
    }
    return reply({ error: "Unknown action" }, 400);
  } catch (e) { console.error("mpr-api failed", e); return reply({ error: "Request failed" }, 500); }
});
