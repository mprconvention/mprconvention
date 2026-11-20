import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, RefreshCw, Shield, UserPlus } from "lucide-react";
import { AuditCells, AuditHeaders } from "./RecordAudit";
import type { RecordAudit } from "../lib/recordAudit";
import { mprInvoke } from "../lib/mprAuth";
import { supabase } from "../lib/supabase";

type AssignableRole = "manager" | "staff" | "viewer";
type Permission = { module: string; action: string };
type User = RecordAudit & {
  id: string;
  username: string;
  email: string | null;
  full_name: string;
  role: AssignableRole | "admin";
  is_active: boolean;
  last_login_at: string | null;
  permissions: Permission[];
};

const modules = ["dashboard", "calendar", "bookings", "calendar_blocks", "booking_workflow", "customers", "venues", "auspicious_dates", "reports"];
const actions = ["view", "create", "edit", "delete"];
const emptyForm = () => ({ username: "", email: "", full_name: "", password: "", role: "staff" as AssignableRole });
const permissionKey = ({ module, action }: Permission) => `${module}:${action}`;

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [grants, setGrants] = useState<string[]>([]);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = await mprInvoke<{ users: User[] }>(supabase!, "admin-list-users", {});
      setUsers(result.users);
    } catch (e: any) {
      setError(e.message ?? "Unable to load users");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { void load(); }, []);

  function start(user?: User) {
    if (user?.role === "admin") return;
    setError("");
    setEditingUser(user ?? null);
    setForm({ ...emptyForm(), role: user?.role ?? "staff" });
    setGrants(user ? (user.permissions ?? []).map(permissionKey) : ["dashboard:view", "calendar:view"]);
    setShowForm(true);
  }

  function toggle(key: string) {
    setGrants(current => current.includes(key) ? current.filter(grant => grant !== key) : [...current, key]);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const permissions = grants.map(grant => {
      const [module, action] = grant.split(":");
      return { module, action };
    }).filter(grant => form.role !== "viewer" || grant.action === "view");
    try {
      if (editingUser) {
        await mprInvoke(supabase!, "admin-update-user", {
          user_id: editingUser.id, role: form.role, permissions,
        });
      } else {
        await mprInvoke(supabase!, "admin-create-user", { ...form, email: form.email || null, permissions });
      }
      setShowForm(false);
      setForm(emptyForm());
      await load();
    } catch (e: any) {
      setError(e.message ?? "Unable to save user access");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(user: User) {
    setBusy(true);
    setError("");
    try {
      await mprInvoke(supabase!, "admin-update-user", { user_id: user.id, is_active: !user.is_active });
      await load();
    } catch (e: any) {
      setError(e.message ?? "Unable to update user");
    } finally {
      setBusy(false);
    }
  }

  return <div className="user-manager">
    <div className="toolbar">
      <div><b>{users.length} MPR accounts</b><span>Manage team roles, module grants and account status.</span></div>
      <div className="toolbar-actions">
        <button className="outline-btn" onClick={() => void load()} disabled={busy}><RefreshCw size={15}/> Refresh</button>
        <button className="primary-small" onClick={() => start()} disabled={busy}><UserPlus size={16}/> Add user</button>
      </div>
    </div>
    {error && <div className="error-box" role="alert">{error}</div>}
    {showForm && <form className="create-user" onSubmit={save}>
      <div className="section-row"><div>
        <h3>{editingUser ? `Edit access for ${editingUser.full_name}` : "Create MPR user"}</h3>
        <p>{editingUser ? "Saving access updates signs the user out of existing sessions." : "New users must change their temporary password after first login."}</p>
      </div></div>
      <div className="form-grid">
        {!editingUser && <>
          <label>Full name<input required autoComplete="name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}/></label>
          <label>Username<input required autoComplete="username" minLength={3} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}/></label>
          <label>Email (optional)<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></label>
          <label>Temporary password<input type="password" required autoComplete="new-password" minLength={12} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}/></label>
        </>}
        <label>Role<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as AssignableRole })}>
          <option value="manager">Manager</option><option value="staff">Team</option><option value="viewer">Viewer</option>
        </select></label>
      </div>
      <h4>Module permissions</h4>
      <div className="permission-grid">
        {modules.map(module => <div className="permission-row" key={module}><b>{module.replaceAll("_", " ")}</b>
          {actions.map(action => {
            const key = permissionKey({ module, action });
            const implied = form.role === "manager" && module === "auspicious_dates";
            const readOnly = (form.role === "viewer" && action !== "view") ||
              (module === "booking_workflow" && action === "delete");
            return <label key={action}><input type="checkbox" aria-label={`${module.replaceAll("_", " ")} ${action}`}
              disabled={implied || readOnly} checked={implied || (!readOnly && grants.includes(key))}
              onChange={() => toggle(key)}/>{action}</label>;
          })}
        </div>)}
      </div>
      <div className="toolbar-actions">
        <button type="button" className="outline-btn" onClick={() => { setShowForm(false); setForm(emptyForm()); }} disabled={busy}>Cancel</button>
        <button className="primary-small" disabled={busy}>{editingUser ? "Save access" : "Create account"}</button>
      </div>
    </form>}
    <div className="table-wrap">
      <table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><AuditHeaders/><th>Actions</th></tr></thead>
        <tbody>{users.map(user => <tr key={user.id}>
          <td><div className="table-user"><div className="avatar">{user.full_name.slice(0, 1)}</div>
            <div><b>{user.full_name}</b><small>@{user.username} · {user.email ?? "No email"}</small></div>
          </div></td>
          <td><span className="role-tag"><Shield size={12}/>{user.role === "staff" ? "Team" : user.role}</span></td>
          <td><span className={user.is_active ? "status-active" : "status-inactive"}><i/>{user.is_active ? "Active" : "Inactive"}</span></td>
          <td>{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "Never"}</td>
          <AuditCells record={user}/>
          <td>{user.role !== "admin" && <div className="toolbar-actions">
            <button className="text-action" disabled={busy} onClick={() => start(user)}>Edit access</button>
            <button className="text-action" disabled={busy} onClick={() => void toggleActive(user)}>{user.is_active ? "Deactivate" : "Activate"}</button>
          </div>}</td>
        </tr>)}</tbody>
      </table>
      {!users.length && !busy && <div className="empty-state"><CheckCircle2 size={22}/> No MPR users found.</div>}
    </div>
  </div>;
}
