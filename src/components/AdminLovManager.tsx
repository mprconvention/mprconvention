import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mprInvoke } from "../lib/mprAuth";

type LovList = { id: string; list_code: string; list_name: string; description: string | null };
type LovValue = {
  id: string; value_code: string; display_label: string; description: string | null;
  sort_order: number; is_active: boolean; is_default: boolean;
};

export function AdminLovManager({ supabase }: { supabase: SupabaseClient }) {
  const [lists, setLists] = useState<LovList[]>([]);
  const [listId, setListId] = useState("");
  const [values, setValues] = useState<LovValue[]>([]);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadLists() {
    const { data } = await mprInvoke<{data:LovList[]}>(supabase, "mpr-api", { action: "list-lov-lists" });
    setLists(data ?? []);
    if (!listId && data?.length) setListId(data[0].id);
  }

  async function loadValues(id: string) {
    const { data } = await mprInvoke<{data:LovValue[]}>(supabase, "mpr-api", { action: "list-lov-values", list_id: id });
    setValues(data ?? []);
  }

  useEffect(() => { loadLists().catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (listId) loadValues(listId).catch((e) => setError(e.message)); }, [listId]);

  async function addValue() {
    if (!listId || !/^[a-z][a-z0-9_]{0,62}$/.test(code) || !label.trim()) {
      setError("Enter a valid stable code and display label.");
      return;
    }
    setBusy(true); setError("");
    try {
      await mprInvoke(supabase, "mpr-api", { action: "add-lov-value", list_id: listId, value_code: code, display_label: label.trim(), description: description.trim() || null, sort_order: values.length * 10 });
    } catch (e: any) { setBusy(false); setError(e.message); return; }
    setBusy(false);
    setCode(""); setLabel(""); setDescription("");
    await loadValues(listId);
  }

  async function updateValue(value: LovValue, patch: Partial<LovValue>) {
    setError("");
    try { await mprInvoke(supabase, "mpr-api", { action: "update-lov-value", id: value.id, ...patch }); }
    catch (e: any) { setError(e.message); return; }
    await loadValues(listId);
  }

  return (
    <section>
      <h2>Admin · Configurable Lists</h2>
      <p>Manage dropdown values used across MPR. Codes are stable database identifiers; labels can be renamed.</p>
      {error && <p role="alert">{error}</p>}
      <label>List{" "}
        <select value={listId} onChange={(e) => setListId(e.target.value)}>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.list_name}</option>)}
        </select>
      </label>

      <h3>Add value</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input placeholder="stable_code" value={code} onChange={(e) => setCode(e.target.value)} />
        <input placeholder="Display label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button type="button" disabled={busy} onClick={addValue}>Add</button>
      </div>

      <h3>Existing values</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {values.map((v) => (
          <LovValueRow key={v.id} value={v} onSave={(patch) => updateValue(v, patch)} />
        ))}
      </div>
    </section>
  );
}

function LovValueRow({
  value, onSave,
}: {
  value: LovValue;
  onSave: (patch: Partial<LovValue>) => Promise<void>;
}) {
  const [label, setLabel] = useState(value.display_label);
  const [description, setDescription] = useState(value.description ?? "");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(100px,1fr) minmax(120px,2fr) auto auto", gap: 8, alignItems: "center" }}>
      <code>{value.value_code}</code>
      <input aria-label={`Label for ${value.value_code}`} value={label} onChange={(e) => setLabel(e.target.value)} />
      <label><input type="checkbox" checked={value.is_active} onChange={(e) => onSave({ is_active: e.target.checked })} /> Active</label>
      <button type="button" onClick={() => onSave({ display_label: label, description: description || null })}>Save</button>
    </div>
  );
}
