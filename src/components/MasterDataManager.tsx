import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, RefreshCw, X, Save, Power, Trash2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mprInvoke } from "../lib/mprAuth";

type Module = "customers" | "venues" | "auspicious_dates";
type Row = Record<string, any> & { id: string };
type Props = { module: Module; supabase: SupabaseClient; permissions: {module:string;action:string}[]; role: string };
const configs = {
  customers: { title: "Customers", list: "list-customers", save: "save-customer", deactivate: "delete-customer", columns: ["customer_name","mobile","email","city"] },
  venues: { title: "Venues", list: "list-venues", save: "save-venue", deactivate: "deactivate-venue", columns: ["venue_name","venue_code","city","timezone"] },
  auspicious_dates: { title: "Auspicious dates", list: "list-auspicious-dates", save: "save-auspicious-date", deactivate: "deactivate-auspicious-date", columns: ["date","title","category_code","region_code"] }
} as const;

const empty = (module: Module): Row => module === "customers"
  ? { customer_name:"", mobile:"", email:"", address:"", city:"", customer_category_code:"", notes:"" }
  : module === "venues"
  ? { venue_name:"", venue_code:"", venue_type_code:"", address:"", city:"", timezone:"Asia/Kolkata" }
  : { date:"", title:"", category_code:"", description:"", region_code:"", source:"" };

const labels: Record<string,string> = {
  customer_name:"Customer name", mobile:"Mobile", email:"Email", address:"Address", city:"City",
  customer_category_code:"Customer category", notes:"Notes", venue_name:"Venue name", venue_code:"Venue code",
  venue_type_code:"Venue type", timezone:"Timezone", date:"Date", title:"Title", category_code:"Category",
  description:"Description", region_code:"Region", source:"Source"
};

export function MasterDataManager({ module, supabase, permissions, role }: Props) {
  const config = configs[module];
  const can = (action:string) => role === "admin" || (role === "manager" && module === "auspicious_dates") || permissions.some(p => p.module === module && p.action === action);
  const [rows,setRows] = useState<Row[]>([]);
  const [query,setQuery] = useState("");
  const [form,setForm] = useState<Row|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const result = await mprInvoke<{data:Row[]}>(supabase,"mpr-api",{action:config.list});
      setRows(result.data ?? []);
    } catch (e:any) { setError(e.message ?? "Unable to load records."); }
    finally { setBusy(false); }
  }, [supabase, config.list]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter(row => Object.values(row).some(v => String(v ?? "").toLowerCase().includes(q))) : rows;
  }, [rows,query]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await mprInvoke(supabase,"mpr-api",{action:config.save,...form});
      setForm(null); setMessage("Record saved successfully."); await load();
    } catch (e:any) { setError(e.message ?? "Unable to save record."); }
    finally { setBusy(false); }
  }

  async function deactivate(row:Row) {
    const label = String(row.customer_name ?? row.venue_name ?? row.title ?? "this record");
    const prompt = module === "customers"
      ? `Permanently delete ${label}? This is allowed only when no booking is linked.`
      : `Deactivate ${label}? It will remain in historical records.`;
    if (!window.confirm(prompt)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await mprInvoke(supabase,"mpr-api",{action:config.deactivate,id:row.id});
      setMessage(module === "customers" ? "Customer deleted." : "Record deactivated.");
      await load();
    } catch(e:any) { setError(e.message ?? "Unable to complete the action."); }
    finally { setBusy(false); }
  }

  const columns = config.columns;
  return <div className="master-module">
    <div className="master-toolbar">
      <div className="master-search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${config.title.toLowerCase()}…`}/></div>
      <div className="master-actions">
        <button className="outline-btn" onClick={()=>void load()} disabled={busy}><RefreshCw size={15}/> Refresh</button>
        {can("create") && <button className="primary-btn" onClick={()=>setForm({...empty(module),id:""})}><Plus size={16}/> Add {module==="customers"?"customer":module==="venues"?"venue":"date"}</button>}
      </div>
    </div>
    {error&&<div className="error-box master-message">{error}</div>}
    {message&&<div className="notice master-message" role="status">{message}<button onClick={()=>setMessage("")}>×</button></div>}
    <div className="master-table-wrap">
      <table className="master-table"><thead><tr>{columns.map(c=><th key={c}>{labels[c] ?? c}</th>)}<th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {filtered.map(row=><tr key={row.id}>
            {columns.map(c=><td key={c}>{c==="date" ? String(row[c]??"").slice(0,10) : String(row[c]??"—")}</td>)}
            <td><span className={`master-status ${row.is_active===false?"inactive":"active"}`}>{row.is_active===false?"Inactive":"Active"}</span></td>
            <td><div className="master-row-actions">
              {can("edit")&&<button className="icon-btn" title="Edit" onClick={()=>setForm({...row})}><Pencil size={15}/></button>}
              {can("delete")&&<button className="icon-btn danger" title={module==="customers"?"Delete":"Deactivate"} onClick={()=>void deactivate(row)}>{module==="customers"?<Trash2 size={15}/>:<Power size={15}/>}</button>}
            </div></td>
          </tr>)}
          {!busy && filtered.length===0 && <tr><td colSpan={columns.length+2} className="master-empty">No records found.</td></tr>}
        </tbody>
      </table>
      {busy&&<div className="master-loading">Working…</div>}
    </div>
    {form&&<div className="master-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setForm(null);}}>
      <form className="master-modal" onSubmit={save}>
        <div className="master-modal-head"><div><span className="eyebrow">{form.id?"UPDATE RECORD":"NEW RECORD"}</span><h2>{form.id?"Edit":"Add"} {module==="customers"?"customer":module==="venues"?"venue":"auspicious date"}</h2></div><button type="button" className="icon-btn" onClick={()=>setForm(null)}><X size={18}/></button></div>
        <div className="master-form-grid">
          {Object.keys(empty(module)).map(key=><label key={key} className={["address","notes","description"].includes(key)?"wide":""}>{labels[key] ?? key}
            {["address","notes","description"].includes(key)
              ? <textarea rows={key==="address"?2:3} value={form[key]??""} onChange={e=>setForm({...form,[key]:e.target.value})}/>
              : <input type={key==="date"?"date":key==="email"?"email":"text"} required={["customer_name","venue_name","date","title"].includes(key)} value={form[key]??""} onChange={e=>setForm({...form,[key]:e.target.value})} />}
          </label>)}
        </div>
        {error&&<div className="error-box">{error}</div>}
        <div className="master-modal-footer"><button type="button" className="outline-btn" onClick={()=>setForm(null)}>Cancel</button><button className="primary-btn" disabled={busy}><Save size={16}/>{busy?"Saving…":"Save changes"}</button></div>
      </form>
    </div>}
  </div>;
}
