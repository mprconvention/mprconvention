import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mprInvoke } from "../lib/mprAuth";
import type { RecordAudit } from "../lib/recordAudit";
import { AuditCells, AuditDetails, AuditHeaders } from "./RecordAudit";

type LovList = RecordAudit & {
  id: string;
  list_code: string;
  list_name: string;
  description: string | null;
};

type LovValue = RecordAudit & {
  id: string;
  value_code: string;
  display_label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

type ListDraft = { id?: string; list_code: string; list_name: string; description: string | null };
const emptyList = { list_code: "", list_name: "", description: "" };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to save picklist configuration.";
}

export function AdminLovManager({ supabase }: { supabase: SupabaseClient }) {
  const [lists, setLists] = useState<LovList[]>([]);
  const [listId, setListId] = useState("");
  const [listDraft, setListDraft] = useState<ListDraft | null>(null);
  const [values, setValues] = useState<LovValue[]>([]);
  const [revision, setRevision] = useState(0);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = lists.find(list => list.id === listId);

  useEffect(() => {
    let current = true;
    mprInvoke<{ data: LovList[] }>(supabase, "mpr-api", { action: "list-lov-lists" })
      .then(({ data }) => {
        if (!current) return;
        setLists(data);
        setListId(id => data.some(list => list.id === id) ? id : data[0]?.id ?? "");
      })
      .catch(error => { if (current) setError(errorMessage(error)); });
    return () => { current = false; };
  }, [supabase, revision]);

  useEffect(() => {
    if (!listId) return;
    let current = true;
    mprInvoke<{ data: LovValue[] }>(supabase, "mpr-api", {
      action: "list-lov-values", list_id: listId,
    }).then(({ data }) => {
      if (current) setValues(data);
    }).catch(error => { if (current) setError(errorMessage(error)); });
    return () => { current = false; };
  }, [supabase, listId, revision]);

  async function saveList(event: FormEvent) {
    event.preventDefault();
    if (!listDraft) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await mprInvoke<{ data: { id: string } }>(supabase, "mpr-api", {
        action: listDraft.id ? "update-lov-list" : "create-lov-list",
        id: listDraft.id,
        list_code: listDraft.list_code,
        list_name: listDraft.list_name,
        description: listDraft.description,
      });
      if (data.id !== listId) setValues([]);
      setListId(data.id);
      setListDraft(null);
      setRevision(value => value + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveValue(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await mprInvoke(supabase, "mpr-api", payload);
      setRevision(value => value + 1);
      return true;
    } catch (error) {
      setError(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addValue(event: FormEvent) {
    event.preventDefault();
    const sortOrder = Math.max(0, ...values.map(value => value.sort_order)) + 10;
    if (await saveValue({
      action: "add-lov-value", list_id: listId, value_code: code,
      display_label: label, description, sort_order: sortOrder,
    })) {
      setCode("");
      setLabel("");
      setDescription("");
    }
  }

  return (
    <section className="master-module">
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="master-toolbar">
        <label>Picklist{" "}
          <select value={listId} disabled={busy || !lists.length} onChange={event => {
            setValues([]);
            setListDraft(null);
            setCode("");
            setLabel("");
            setDescription("");
            setListId(event.target.value);
            setError("");
          }}>
            {!lists.length && <option value="">No picklists</option>}
            {lists.map(list => <option key={list.id} value={list.id}>{list.list_name}</option>)}
          </select>
        </label>
        <div className="master-actions">
          {selected && <button type="button" className="outline-btn" disabled={busy} onClick={() => setListDraft(selected)}>Edit picklist</button>}
          <button type="button" className="primary-btn" disabled={busy} onClick={() => setListDraft(emptyList)}>Add picklist</button>
        </div>
      </div>
      {selected && <>
        <p><code>{selected.list_code}</code>{selected.description && <> · {selected.description}</>}</p>
        <AuditDetails record={selected}/>
      </>}
      {listDraft && (
        <form className="create-user" onSubmit={saveList}>
          <div className="form-grid">
            <label>Stable code<input required pattern="[a-z][a-z0-9_]{1,62}" readOnly={Boolean(listDraft.id)}
              value={listDraft.list_code} onChange={event => setListDraft({ ...listDraft, list_code: event.target.value })}/></label>
            <label>Picklist name<input required maxLength={200}
              value={listDraft.list_name} onChange={event => setListDraft({ ...listDraft, list_name: event.target.value })}/></label>
            <label>Description<input maxLength={500} value={listDraft.description ?? ""}
              onChange={event => setListDraft({ ...listDraft, description: event.target.value })}/></label>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="outline-btn" onClick={() => setListDraft(null)}>Cancel</button>
            <button className="primary-btn" disabled={busy}>Save picklist</button>
          </div>
        </form>
      )}
      {selected && <>
        <form className="create-user" onSubmit={addValue}>
          <h3>Add value</h3>
          <div className="form-grid">
            <label>Stable code<input required pattern="[a-z][a-z0-9_]{0,62}" value={code} onChange={event => setCode(event.target.value)}/></label>
            <label>Display label<input required maxLength={200} value={label} onChange={event => setLabel(event.target.value)}/></label>
            <label>Description<input maxLength={500} value={description} onChange={event => setDescription(event.target.value)}/></label>
          </div>
          <button className="primary-btn" disabled={busy}>Add value</button>
        </form>
        <div className="master-table-wrap">
          <table className="master-table">
            <thead><tr><th>Code</th><th>Display label</th><th>Description</th><th>Sort order</th><th>Active</th><AuditHeaders/><th>Actions</th></tr></thead>
            <tbody>
              {values.map(value => (
                <ValueRow key={`${value.id}-${value.updated_at}`} value={value} busy={busy}
                  onSave={patch => saveValue({ action: "update-lov-value", id: value.id, ...patch })}/>
              ))}
              {!values.length && <tr><td colSpan={10}>No values to display.</td></tr>}
            </tbody>
          </table>
        </div>
      </>}
    </section>
  );
}

type ValuePatch = Pick<LovValue, "display_label" | "description" | "sort_order" | "is_active">;

function ValueRow({ value, busy, onSave }: {
  value: LovValue;
  busy: boolean;
  onSave: (patch: ValuePatch) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<ValuePatch>(value);
  const [sortOrder, setSortOrder] = useState(String(value.sort_order));
  const validOrder = sortOrder.trim() !== "" && Number.isInteger(Number(sortOrder));
  return (
    <tr>
      <td><code>{value.value_code}</code></td>
      <td><input aria-label={`Label for ${value.value_code}`} value={draft.display_label} maxLength={200}
        onChange={event => setDraft({ ...draft, display_label: event.target.value })}/></td>
      <td><input aria-label={`Description for ${value.value_code}`} value={draft.description ?? ""} maxLength={500}
        onChange={event => setDraft({ ...draft, description: event.target.value })}/></td>
      <td><input aria-label={`Sort order for ${value.value_code}`} type="number" value={sortOrder}
        onChange={event => setSortOrder(event.target.value)}/></td>
      <td><input aria-label={`Active status for ${value.value_code}`} type="checkbox" checked={draft.is_active}
        onChange={event => setDraft({ ...draft, is_active: event.target.checked })}/></td>
      <AuditCells record={value}/>
      <td><button type="button" className="outline-btn" disabled={busy || !draft.display_label.trim() || !validOrder}
        onClick={() => void onSave({
          display_label: draft.display_label,
          description: draft.description,
          is_active: draft.is_active,
          sort_order: Number(sortOrder),
        })}>Save</button></td>
    </tr>
  );
}
