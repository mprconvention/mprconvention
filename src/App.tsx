import { useEffect, useState } from 'react';
import {
  Activity, CalendarDays, Users, Building2, ClipboardList, Settings, LogOut,
  Menu, Search, ChevronDown, ArrowUpRight, ShieldCheck, LockKeyhole,
  LayoutDashboard, CalendarCheck, CalendarX, Star, KeyRound, Eye, EyeOff
} from 'lucide-react';
import { supabase, configReady } from './lib/supabase';
import {
  getMprToken, mprLogin, mprLogout, mprInvoke, mprChangePassword, type MprUser
} from './lib/mprAuth';
import { MprCalendars } from './components/MprCalendars';
import { AdminLovManager } from './components/AdminLovManager';
import { UserManagement } from './components/UserManagement';
import { MasterDataManager } from './components/MasterDataManager';

type Page = 'dashboard'|'calendar'|'bookings'|'customers'|'venues'|'auspicious'|'users'|'lovs'|'reports'|'settings';

const nav: {id: Page; label: string; icon: any; module: string}[] = [
  {id:'dashboard',label:'Dashboard',icon:LayoutDashboard,module:'dashboard'},
  {id:'calendar',label:'Event calendars',icon:CalendarDays,module:'calendar'},
  {id:'bookings',label:'Bookings',icon:ClipboardList,module:'bookings'},
  {id:'customers',label:'Customers',icon:Users,module:'customers'},
  {id:'venues',label:'Venues',icon:Building2,module:'venues'},
  {id:'auspicious',label:'Auspicious dates',icon:Star,module:'auspicious_dates'},
  {id:'users',label:'User access',icon:ShieldCheck,module:'users'},
  {id:'lovs',label:'Configuration',icon:Settings,module:'lovs'},
  {id:'reports',label:'Reports',icon:Activity,module:'reports'}
];

export default function App() {
  const [user,setUser] = useState<MprUser|null>(null);
  const [permissions,setPermissions] = useState<{module:string;action:string}[]>([]);
  const [page,setPage] = useState<Page>('dashboard');
  const [loading,setLoading] = useState(true);
  const [mobile,setMobile] = useState(false);
  const [notice,setNotice] = useState('');

  useEffect(() => {
    let live = true;
    async function init() {
      if (!supabase || !getMprToken()) { setLoading(false); return; }
      try {
        const r = await mprInvoke<{user:MprUser;permissions:{module:string;action:string}[]}>(supabase,'mpr-me',{});
        if (live) { setUser(r.user); setPermissions(r.permissions??[]); }
      } catch {
        if (live) sessionStorage.removeItem('mpr_session_token');
      } finally {
        if (live) setLoading(false);
      }
    }
    init();
    return () => { live = false; };
  }, []);

  const can = (module:string) =>
    user?.role === 'admin' || permissions.some(p => p.module===module && p.action==='view');

  async function signOut() {
    if (supabase) await mprLogout(supabase);
    setUser(null); setPermissions([]); setPage('dashboard');
  }

  if (!configReady || !supabase) return <SetupScreen />;
  if (loading) return <div className="loading"><div className="brand-mark">M</div><p>Preparing your workspace…</p></div>;
  if (!user) return <Login onLogin={(u,p) => { setUser(u); setPermissions(p); setNotice('Welcome back. Your MPR workspace is ready.'); }} />;
  if (user.must_change_password) return <ChangePassword onDone={async () => { await signOut(); setNotice('Password updated. Please sign in with your new password.'); }} />;

  const allowedNav = nav.filter(n => can(n.module));

  return <div className="shell">
    <aside className={`sidebar ${mobile?'open':''}`}>
      <div className="brand"><div className="brand-mark">M</div><div><b>MPR</b><span>EVENT MANAGEMENT</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{allowedNav.map(n => <button key={n.id} className={`nav-item ${page===n.id?'active':''}`} onClick={() => {setPage(n.id);setMobile(false);}}><n.icon size={18}/><span>{n.label}</span>{page===n.id&&<span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="secure-note"><LockKeyhole size={16}/><span>Private MPR workspace<br/><small>Custom authentication enabled</small></span></div>
        <button className="nav-item" onClick={signOut}><LogOut size={18}/><span>Sign out</span></button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar">
        <button className="icon-btn mobile-menu" onClick={() => setMobile(!mobile)}><Menu/></button>
        <div className="crumb">MPR <span>/</span> {nav.find(n=>n.id===page)?.label??'Settings'}</div>
        <div className="top-actions">
          <div className="live-pill"><i/> System connected</div>
          <div className="user-chip"><div className="avatar">{user.full_name.slice(0,1).toUpperCase()}</div><div><b>{user.full_name}</b><small>{user.role}</small></div><ChevronDown size={15}/></div>
        </div>
      </header>
      <section className="content">
        {notice&&<div className="notice" onClick={() => setNotice('')}>{notice}<button>×</button></div>}
        <div className="page-heading"><div><div className="eyebrow">MANAGEMENT CONSOLE</div><h1>{pageTitle(page)}</h1><p>{pageSubtitle(page)}</p></div><div className="date-chip"><CalendarDays size={16}/>{new Date().toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}</div></div>
        {page==='dashboard'&&<Dashboard user={user} onNavigate={setPage}/>}
        {page==='calendar'&&<MprCalendars supabase={supabase}/>}
        {page==='users'&&user.role==='admin'&&<UserManagement/>}
        {page==='lovs'&&user.role==='admin'&&<AdminLovManager supabase={supabase}/>}
        {page==='customers'&&<MasterDataManager module="customers" supabase={supabase} permissions={permissions} role={user.role}/>}
        {page==='venues'&&<MasterDataManager module="venues" supabase={supabase} permissions={permissions} role={user.role}/>}
        {page==='auspicious'&&<MasterDataManager module="auspicious_dates" supabase={supabase} permissions={permissions} role={user.role}/>}
        {!['dashboard','calendar','users','lovs','customers','venues','auspicious'].includes(page)&&<ComingSoon page={page}/>}
        {page==='users'&&user.role!=='admin'&&<NoAccess/>}
        {page==='lovs'&&user.role!=='admin'&&<NoAccess/>}
        <footer className="footer"><span>© {new Date().getFullYear()} MPR Management</span><span>Secure operations <ShieldCheck size={13}/></span></footer>
      </section>
    </main>
  </div>;
}

function pageTitle(p:Page) {
  return ({dashboard:'Good evening',calendar:'Event calendars',bookings:'Bookings',customers:'Customers',venues:'Venue management',auspicious:'Auspicious dates',users:'User access',lovs:'Configuration',reports:'Reports',settings:'Settings'} as any)[p];
}
function pageSubtitle(p:Page) {
  return ({dashboard:'Here is what is happening across your venues today.',calendar:'Track reserved, blocked and auspicious dates across every venue.',bookings:'Create, review and manage event reservations.',customers:'Your customer directory and relationship history.',venues:'Manage locations, availability and venue details.',auspicious:'Maintain important dates for your regions and customers.',users:'Manage MPR accounts, roles and module permissions.',lovs:'Control dropdown values and configurable business lists.',reports:'Review booking activity and operational performance.'} as any)[p];
}
function SetupScreen() {
  return <div className="center-screen"><div className="login-card"><div className="brand-mark">M</div><h1>Connect your MPR project</h1><p>Add your Supabase project URL and publishable/anon key to the environment file.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_ANON_KEY</code><p className="muted">Create <b>.env.local</b> in the project root, then restart the development server.</p></div></div>;
}

/* Reusable password field with an independent show/hide toggle. */
function PasswordInput({label,value,onChange,autoComplete,placeholder,minLength,required=true}:{
  label:string; value:string; onChange:(value:string)=>void; autoComplete?:string;
  placeholder?:string; minLength?:number; required?:boolean;
}) {
  const [visible,setVisible] = useState(false);
  return <label>{label}
    <div style={{position:'relative',width:'100%'}}>
      <input type={visible?'text':'password'} autoComplete={autoComplete} value={value}
        onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        minLength={minLength} required={required}
        style={{width:'100%',paddingRight:'48px'}}/>
      <button type="button" onClick={()=>setVisible(v=>!v)}
        aria-label={visible?`Hide ${label.toLowerCase()}`:`Show ${label.toLowerCase()}`}
        title={visible?'Hide password':'Show password'}
        style={{position:'absolute',right:'12px',top:'50%',transform:'translateY(-50%)',
          border:'none',background:'transparent',cursor:'pointer',padding:'5px',
          display:'flex',alignItems:'center',justifyContent:'center',color:'#64748b'}}>
        {visible?<EyeOff size={19}/>:<Eye size={19}/>}
      </button>
    </div>
  </label>;
}

function Login({onLogin}:{onLogin:(u:MprUser,p:{module:string;action:string}[])=>void}) {
  const [identifier,setIdentifier] = useState('');
  const [password,setPassword] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');

  async function submit(e:React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await mprLogin(supabase!,identifier,password);
      onLogin(r.user,r.permissions??[]);
    } catch(e:any) {
      setError(e.message??'Unable to sign in. Check your credentials.');
    } finally { setBusy(false); }
  }

  return <div className="login-layout">
    <div className="login-art">
      <div className="art-orb orb-one"/><div className="art-orb orb-two"/>
      <div className="brand large"><div className="brand-mark">M</div><div><b>MPR</b><span>EVENT MANAGEMENT</span></div></div>
      <div className="art-copy"><div className="eyebrow">ONE WORKSPACE. EVERY OCCASION.</div><h1>Make every<br/><em>moment</em> count.</h1><p>Plan venues, coordinate bookings and keep every important date in view.</p></div>
      <div className="art-foot">PRIVATE OPERATIONS PLATFORM <span>•</span> INDIA</div>
    </div>
    <div className="login-panel">
      <form className="login-form" onSubmit={submit}>
        <div className="mobile-brand"><div className="brand-mark">M</div><b>MPR</b></div>
        <div className="eyebrow">WELCOME BACK</div><h2>Sign in to MPR</h2>
        <p className="muted">Use your MPR username or registered email.</p>
        {error&&<div className="error-box">{error}</div>}
        <label>Username or email<input autoComplete="username" value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="Enter username or email" required/></label>
        <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Enter your password"/>
        <button className="primary-btn" disabled={busy}>{busy?'Signing in…':'Sign in securely'} <ArrowUpRight size={17}/></button>
        <div className="form-foot"><LockKeyhole size={14}/> Protected by MPR custom authentication</div>
      </form>
    </div>
  </div>;
}

function ChangePassword({onDone}:{onDone:()=>void}) {
  const [current,setCurrent] = useState('');
  const [next,setNext] = useState('');
  const [confirm,setConfirm] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);

  async function submit(e:React.FormEvent) {
    e.preventDefault();
    if(next.length<12) return setError('Use at least 12 characters.');
    if(next!==confirm) return setError('New passwords do not match.');
    setBusy(true); setError('');
    try { await mprChangePassword(supabase!,current,next); onDone(); }
    catch(e:any) { setError(e.message??'Password update failed.'); }
    finally { setBusy(false); }
  }

  return <div className="center-screen"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark">M</div><div className="eyebrow">ACCOUNT SECURITY</div>
    <h1>Change your password</h1>
    <p className="muted">Your administrator account requires a new password before continuing.</p>
    {error&&<div className="error-box">{error}</div>}
    <PasswordInput label="Current password" value={current} onChange={setCurrent} autoComplete="current-password"/>
    <PasswordInput label="New password" value={next} onChange={setNext} autoComplete="new-password" minLength={12}/>
    <PasswordInput label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password"/>
    <button className="primary-btn" disabled={busy}>{busy?'Updating…':'Update password'} <KeyRound size={16}/></button>
  </form></div>;
}

function Dashboard({user,onNavigate}:{user:MprUser;onNavigate:(p:Page)=>void}) {
  return <>
    <div className="welcome-strip"><div><div className="eyebrow">YOUR OPERATIONS AT A GLANCE</div><h2>Welcome, {user.full_name.split(' ')[0]} <span>✦</span></h2><p>Keep your venues running smoothly. Your next event starts with a clear plan.</p></div><div className="welcome-icon"><CalendarCheck size={32}/></div></div>
    <div className="stat-grid">
      <Stat icon={CalendarCheck} label="Reserved dates" value="—" note="Live booking summary pending API" tone="green"/>
      <Stat icon={CalendarX} label="Blocked dates" value="—" note="Live availability summary pending API" tone="red"/>
      <Stat icon={Star} label="Auspicious dates" value="—" note="View the calendar for date details" tone="gold"/>
      <Stat icon={Building2} label="Active venues" value="—" note="Venue summary pending API" tone="blue"/>
    </div>
    <div className="section-row"><div><h3>Quick access</h3><p>Jump into the areas you use most.</p></div><span className="section-caption">YOUR WORKSPACE</span></div>
    <div className="quick-grid">
      <Quick icon={CalendarDays} title="Event calendars" desc="Reserved, blocked and auspicious dates" onClick={()=>onNavigate('calendar')}/>
      <Quick icon={ClipboardList} title="Bookings" desc="Manage event reservations" onClick={()=>onNavigate('bookings')}/>
      <Quick icon={Users} title="Customers" desc="Customer records and details" onClick={()=>onNavigate('customers')}/>
      <Quick icon={Building2} title="Venues" desc="Your locations and spaces" onClick={()=>onNavigate('venues')}/>
    </div>
    <div className="info-banner"><ShieldCheck size={18}/><div><b>Role-based access is active</b><span>Your {user.role} account only sees modules it is permitted to access.</span></div></div>
  </>;
}
function Stat({icon:Icon,label,value,note,tone}:any) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={19}/></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div>;
}
function Quick({icon:Icon,title,desc,onClick}:any) {
  return <button className="quick-card" onClick={onClick}><div className="quick-icon"><Icon size={20}/></div><div><b>{title}</b><span>{desc}</span></div><ArrowUpRight size={17}/></button>;
}
function ComingSoon({page}:{page:Page}) {
  const [query,setQuery] = useState('');
  return <div className="module-placeholder">
    <div className="placeholder-icon"><Search size={25}/></div><div className="eyebrow">MODULE READY FOR INTEGRATION</div>
    <h2>{pageTitle(page)}</h2>
    <p>The MPR frontend navigation and page shell are ready. The current Supabase <code>mpr-api</code> only supports venue/LOV reads, calendar reads and LOV value updates. This module needs its protected CRUD API actions before it can save or display live records.</p>
    <div className="placeholder-list"><span><i/>Frontend workspace created</span><span><i/>Custom session authentication connected</span><span><i/>Database CRUD endpoints still required</span></div>
    <button className="outline-btn" onClick={()=>setQuery(query?'':'show')}>{query?'Hide integration note':'What needs to be connected?'}</button>
    {query&&<div className="note-panel">Next backend work: add permission-checked actions to <b>supabase/functions/mpr-api/index.ts</b> for this module, validate all inputs server-side, then connect the corresponding forms and tables.</div>}
  </div>;
}
function NoAccess() {
  return <div className="module-placeholder"><ShieldCheck size={28}/><h2>Administrator access required</h2><p>Your current account does not have access to this module.</p></div>;
}
