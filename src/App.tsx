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
