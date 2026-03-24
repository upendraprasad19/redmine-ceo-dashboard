import React, { useState, useEffect } from "react";
import { BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';

const C = {
  bg:       "#030B15",
  surface:  "#070F1C",
  card:     "#0A1628",
  border:   "rgba(255,255,255,0.07)",
  borderHi: "rgba(255,255,255,0.16)",
  blue:     "#1A6EF5",
  blueLight:"#4B9BFF",
  white:    "#F0F4FF",
  dim:      "rgba(240,244,255,0.45)",
  dimmer:   "rgba(240,244,255,0.22)",
  red:      "#E03E3E",
  amber:    "#C97C1A",
  green:    "#1A9E6E",
  sidebarW: 220,
};

// Mock data removed — replaced by dynamic state in Dashboard component
const MOCK = { people: [], projects: [], tickets: [], timeLogs: [] };

function groupBy(arr, key) {
  return (arr || []).reduce((acc, item) => { 
    const val = item[key] || "Unassigned";
    (acc[val] = acc[val] || []).push(item); 
    return acc; 
  }, {});
}
const riskColor  = r => ({ critical:C.red, high:C.amber, medium:C.blueLight, low:C.green }[r?.toLowerCase()] || C.dim);
const statusColor = s => ({ "In Progress":C.blueLight, "Review":C.green, "Blocked":C.red, "Todo":C.dimmer }[s] || C.dim);

const Dot = ({ color, pulse }) => (
  <span style={{ display:"inline-block", width:7, height:7, borderRadius:"50%", flexShrink:0, background:color, animation:pulse?"pulseRing 2s ease infinite":"none" }}/>
);
const Divider = ({ vertical }) => (
  <div style={vertical ? { width:1, background:C.border, alignSelf:"stretch" } : { height:1, background:C.border }}/>
);
const Label = ({ children, size=10 }) => (
  <div style={{ fontSize:size, letterSpacing:"0.12em", color:C.dimmer, textTransform:"uppercase", fontWeight:600, marginBottom:6 }}>{children}</div>
);
const BigNum = ({ value, color, size=38 }) => (
  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:size, fontWeight:700, color:color||C.white, lineHeight:1, letterSpacing:"-0.02em" }}>{value}</div>
);
function Bar({ pct, color, h=4 }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.07)", borderRadius:99, height:h, overflow:"hidden", flex:1 }}>
      <div style={{ width:`${Math.min(pct,100)}%`, height:"100%", background:color||C.blue, borderRadius:99, transition:"width .6s ease" }}/>
    </div>
  );
}
function StatusPill({ status }) {
  const color = statusColor(status);
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:5, background:color+"18", border:`1px solid ${color}44`, borderRadius:6, padding:"3px 9px" }}>
      <Dot color={color}/><span style={{ fontSize:11, color, fontWeight:600 }}>{status}</span>
    </div>
  );
}
function PriorityPill({ pri }) {
  const color = riskColor(pri);
  return (
    <div style={{ display:"inline-flex", background:color+"18", border:`1px solid ${color}44`, borderRadius:6, padding:"3px 9px" }}>
      <span style={{ fontSize:11, color, fontWeight:600 }}>{pri}</span>
    </div>
  );
}
function Avatar({ initials, size=36 }) {
  const safeInitials = initials || "?";
  const c1 = safeInitials.charCodeAt(0) || 0;
  const c2 = safeInitials.charCodeAt(1) || c1;
  const hue = ((c1*7+c2*13)%60)+200;
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, background:`hsl(${hue},40%,14%)`, border:`1px solid hsl(${hue},40%,26%)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*.32, fontWeight:700, color:`hsl(${hue},70%,68%)`, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:"0.04em" }}>{safeInitials}</div>
  );
}
function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"20px 22px", ...style, cursor:onClick?"pointer":"default", transition:"border-color .15s" }}
      onMouseEnter={e=>{ if(onClick) e.currentTarget.style.borderColor=C.borderHi; }}
      onMouseLeave={e=>{ if(onClick) e.currentTarget.style.borderColor=C.border; }}
    >{children}</div>
  );
}
const Chevron = ({ open }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    style={{ transform:open?"rotate(180deg)":"rotate(0deg)", transition:"transform .2s", color:C.dimmer, flexShrink:0 }}>
    <path d="M6 9l6 6 6-6"/>
  </svg>
);
function TeamAccordion({ teamName, count, meta, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:12, overflow:"hidden" }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 20px", background:C.card, cursor:"pointer" }}
        onMouseEnter={e=>e.currentTarget.style.background="#0c1a2e"}
        onMouseLeave={e=>e.currentTarget.style.background=C.card}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.white }}>{teamName}</div>
          {meta && <div style={{ fontSize:11, color:C.amber, marginTop:2 }}>{meta}</div>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:12, color:C.dim, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:600 }}>{count}</span>
          <Chevron open={open}/>
        </div>
      </div>
      {open && (<><Divider/><div style={{ background:C.surface, padding:"12px 14px" }}>{children}</div></>)}
    </div>
  );
}

function PersonModal({ person, onClose }) {
  if (!person) return null;
  const workPct = (person.worked/45)*100;
  const timePct = (person.hours/160)*100;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:300, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ position:"absolute", inset:0, background:"rgba(3,11,21,0.85)", backdropFilter:"blur(6px)" }}/>
      <div onClick={e=>e.stopPropagation()} style={{ position:"relative", background:C.surface, border:`1px solid ${C.borderHi}`, borderRadius:20, padding:"36px 40px", width:520, maxWidth:"90vw" }}>
        <button onClick={onClose} style={{ position:"absolute", top:20, right:20, background:"none", border:"none", color:C.dimmer, fontSize:20, cursor:"pointer" }}>✕</button>
        <div style={{ display:"flex", alignItems:"center", gap:18, marginBottom:30 }}>
          <Avatar initials={person.initials} size={58}/>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:22, fontWeight:700, color:C.white, fontFamily:"'Barlow Condensed',sans-serif" }}>{person.name}</div>
            <div style={{ fontSize:12, color:C.dim, marginTop:3 }}>{person.role} · {person.team}</div>
          </div>
          {person.leave && (
            <div style={{ background:C.amber+"18", border:`1px solid ${C.amber}44`, borderRadius:8, padding:"6px 14px", display:"flex", alignItems:"center", gap:7 }}>
              <Dot color={C.amber} pulse/><span style={{ fontSize:12, color:C.amber, fontWeight:600 }}>{person.leave} Leave</span>
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 28 }}>
          {[
            { label: "Created", val: person.tickets_created || 0, color: C.blueLight },
            { label: "Worked", val: person.tickets_worked || 0, color: C.white },
            { label: "Hours Logged", val: (person.hours_this_month || 0) + "h", color: C.green }
          ].map(s => (
            <div key={s.label} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 16px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 34, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 10, color: C.dimmer, marginTop: 7, letterSpacing: "0.08em", textTransform: "uppercase" }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <Label>Workload Capacity</Label>
            <span style={{ fontSize: 11, color: (person.tickets_worked || 0) > 40 ? C.red : (person.tickets_worked || 0) > 30 ? C.amber : C.green, fontWeight: 600 }}>
              {(person.tickets_worked || 0) > 40 ? "Overloaded" : (person.tickets_worked || 0) > 30 ? "Moderate" : "Balanced"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Bar pct={((person.tickets_worked || 0) / 45) * 100} color={(person.tickets_worked || 0) > 40 ? C.red : (person.tickets_worked || 0) > 30 ? C.amber : C.blue} h={6} />
            <span style={{ fontSize: 11, color: C.dimmer, flexShrink: 0 }}>{person.tickets_worked || 0} / 45</span>
          </div>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <Label>Time Logged (Month)</Label>
            <span style={{ fontSize: 11, color: C.dim }}>{person.hours_this_month || 0}h / 160h</span>
          </div>
          <Bar pct={((person.hours_this_month || 0) / 160) * 100} color={C.blue} h={6} />
        </div>

      </div>
    </div>
  );
}

function TicketModal({ ticket, onClose }) {
  if (!ticket) return null;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:300, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ position:"absolute", inset:0, background:"rgba(3,11,21,0.85)", backdropFilter:"blur(6px)" }}/>
      <div onClick={e=>e.stopPropagation()} style={{ position:"relative", background:C.surface, border:`1px solid ${ticket.overdue?C.red+"66":C.borderHi}`, borderRadius:20, padding:"36px 40px", width:560, maxWidth:"90vw" }}>
        <button onClick={onClose} style={{ position:"absolute", top:20, right:20, background:"none", border:"none", color:C.dimmer, fontSize:20, cursor:"pointer" }}>✕</button>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, color:C.dimmer, letterSpacing:"0.12em", marginBottom:6 }}>{ticket.id}</div>
          <div style={{ fontSize:22, fontWeight:700, color:C.white, fontFamily:"'Barlow Condensed',sans-serif", lineHeight:1.2 }}>{ticket.title}</div>
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:24, flexWrap:"wrap" }}>
          <StatusPill status={ticket.status}/>
          <PriorityPill pri={ticket.pri}/>
          {ticket.overdue && <div style={{ background:C.red+"18", border:`1px solid ${C.red}55`, borderRadius:6, padding:"3px 10px" }}><span style={{ fontSize:11, color:C.red, fontWeight:700 }}>OVERDUE</span></div>}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:24 }}>
          {[["Assigned To",ticket.to],["Assigned By",ticket.by],["Team",ticket.team],["Start Date",ticket.start],["Due Date",ticket.due]].map(([l,v])=>(
            <div key={l} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 16px" }}>
              <div style={{ fontSize:9, color:C.dimmer, letterSpacing:"0.11em", textTransform:"uppercase", marginBottom:5 }}>{l}</div>
              <div style={{ fontSize:13, color:C.white, fontWeight:500 }}>{v}</div>
            </div>
          ))}
        </div>
        <Divider/>
        <div style={{ paddingTop:20 }}>
          <Label>Latest Update</Label>
          <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"16px 18px" }}>
            <div style={{ fontSize:13, color:C.dim, lineHeight:1.7, marginBottom:10 }}>"{ticket.comment}"</div>
            <div style={{ fontSize:11, color:C.dimmer }}>Updated by <span style={{ color:C.blueLight, fontWeight:600 }}>{ticket.commentBy}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Screens (same as before — Overview, TeamLeave, TimeLogs, Tickets, People) ──

function Overview({ overview={}, people=[], tickets=[], timeLogs=[] }) {
  const { kpis={}, projects=[], workload=[] } = overview;
  const DEFAULT_PROJS = ["icast", "iclaims", "reports", "liability", "ilpus"];
  const [selectedProjs, setSelectedProjs] = useState([]);

  // Set defaults on mount
  useEffect(() => {
    if (projects.length > 0 && selectedProjs.length === 0) {
      const init = projects.filter(p => DEFAULT_PROJS.some(dp => p.name.toLowerCase().includes(dp))).map(p=>p.name);
      if(init.length) setSelectedProjs(init);
    }
  }, [projects]);

  const displayProjects = projects.filter(p => selectedProjs.includes(p.name));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:24, animation:"fadeIn .4s ease" }}>
      {/* ── ALERTS BAR ── */}
      {(kpis.overdue_tickets > 0 || kpis.no_time_log > 0) && (
        <div style={{ background:C.red+"12", border:`1px solid ${C.red}44`, borderRadius:12, padding:"12px 20px", display:"flex", alignItems:"center", gap:10 }}>
          <Dot color={C.red} pulse/>
          <span style={{ fontSize:13, color:C.red }}>
            {kpis.overdue_tickets} tickets overdue · {kpis.no_time_log} members haven't logged time today
          </span>
        </div>
      )}

      {/* ── TOP STATS ── */}
      <div className="kpi-grid" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:20 }}>
        {[
          { label:"Headcount", val: `${(kpis.headcount || 0) - (kpis.on_leave || 0)} / ${kpis.headcount || 0}`, color:C.white, sub:"Present / Active Total" },
          { label:"On Leave", val:kpis.on_leave || 0, color:C.amber, sub:"Today" },
          { label:"Overdue", val:kpis.overdue_tickets || 0, color:C.red, sub:"Need attention" },
          { label:"No Time Log", val:kpis.no_time_log || 0, color:C.amber, sub:"End of day" }
        ].map(k=>(
          <Card key={k.label}>
            <Label>{k.label}</Label>
            <BigNum value={k.val} color={k.color}/>
            <div style={{ fontSize:11, color:C.dimmer, marginTop:6 }}>{k.sub}</div>
          </Card>
        ))}
      </div>

      <div className="two-col" style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr", gap:16 }}>
        {/* Project Deadlines */}
        <Card style={{ padding:0, overflow:"hidden" }}>
          <div style={{ padding:"12px 22px 10px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <Label size={11}>Project Deadlines</Label>
            <select 
              value="" 
              onChange={e => {
                const val = e.target.value;
                if(val && !selectedProjs.includes(val)) setSelectedProjs([...selectedProjs, val]);
              }} 
              style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.dim, borderRadius: 6, padding: "4px 8px", fontSize: 11, outline:"none", cursor:"pointer" }}
            >
              <option value="" disabled>+ Add Project</option>
              {projects.filter(p => !selectedProjs.includes(p.name)).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <Divider/>
          <div style={{ padding:"8px 0" }}>
            {displayProjects.length === 0 && <div style={{ padding:20, color:C.dimmer, fontSize:13 }}>No projects pinned. Add one from the dropdown above.</div>}
            {displayProjects.map((p,i)=>(
              <div key={p.name}>
                <div style={{ padding:"14px 22px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:C.white, display:"flex", alignItems:"center", gap: 8 }}>
                      {p.name}
                      <button onClick={() => setSelectedProjs(selectedProjs.filter(sp => sp !== p.name))} style={{ background:"none", border:"none", color:C.amber, cursor:"pointer", fontSize: 16, lineHeight: 1 }}>&times;</button>
                    </span>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <Dot color={riskColor(p.risk)}/><span style={{ fontSize:11, color:C.dimmer }}>{p.deadline ? new Date(p.deadline).toLocaleDateString() : 'No date'}</span>
                      <div style={{ background:riskColor(p.risk)+"20", border:`1px solid ${riskColor(p.risk)}44`, borderRadius:4, padding:"2px 8px" }}>
                        <span style={{ fontSize:10, color:riskColor(p.risk), fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{p.risk}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <Bar pct={p.progress_pct || 0} color={riskColor(p.risk)} h={5}/>
                    <span style={{ fontSize:11, color:C.dimmer, flexShrink:0, width:36, textAlign:"right" }}>{p.progress_pct || 0}%</span>
                  </div>
                </div>
                {i<displayProjects.length-1 && <Divider/>}
              </div>
            ))}
          </div>
        </Card>

        {/* Workload by Team — Bar Chart */}
        <Card style={{ padding:0, overflow:"hidden" }}>
          <div style={{ padding:"18px 22px 14px" }}><Label size={11}>Workload by Team</Label></div>
          <Divider/>
          <div style={{ padding:"12px 16px 8px" }}>
            {workload.length === 0 && <div style={{ padding:20, color:C.dimmer, fontSize:13 }}>No team data available</div>}
            {workload.length > 0 && (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={workload} margin={{ top: 8, right: 16, bottom: 0, left: -20 }}>
                    <XAxis dataKey="team" tick={{ fill: 'rgba(240,244,255,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(240,244,255,0.45)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#070F1C', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, color: '#F0F4FF', fontSize: 12 }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v) => [`${v} avg tickets`, 'Workload']} />
                    <RBar dataKey="avg_tickets_per_person" radius={[4,4,0,0]}>
                      {workload.map((w) => {
                        const pct = (w.avg_tickets_per_person / 10) * 100;
                        const col = pct > 80 ? '#E03E3E' : pct > 60 ? '#C97C1A' : '#1A6EF5';
                        return <Cell key={w.team} fill={col} />;
                      })}
                    </RBar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:10, paddingBottom:4 }}>
                  {workload.map((w) => (
                    <span key={w.team} style={{ fontSize:10, color:'rgba(240,244,255,0.45)', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:6, padding:"3px 8px" }}>{w.team}: {w.member_count}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function TeamLeave({ people=[], onSelectPerson }) {
  const teamGroups = groupBy(people, "team");
  const onLeave = people.filter(p => p.leave).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
        {[
          { label: "On Leave", val: onLeave, color: C.amber, sub: "Today" },
          { label: "Available", val: people.length - onLeave, color: C.green, sub: "Working today" },
          { label: "Teams", val: Object.keys(teamGroups).length, color: C.white, sub: "Total teams" }
        ].map(k => (
          <Card key={k.label}>
            <Label>{k.label}</Label>
            <BigNum value={k.val} color={k.color} />
            <div style={{ fontSize: 11, color: C.dimmer, marginTop: 6 }}>{k.sub}</div>
          </Card>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {Object.entries(teamGroups).map(([team, members]) => {
          const onL = members.filter(m => m.leave).length;
          return (
            <Card key={team} style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.white }}>{team}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {onL > 0 && <span style={{ fontSize: 11, color: C.amber }}>{onL} on leave</span>}
                  <span style={{ fontSize: 11, color: C.dimmer }}>{members.length} members</span>
                </div>
              </div>
              <Divider />
              {members.map((m, i) => (
                <div key={m.id || i}>
                  <div onClick={() => onSelectPerson(m)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 20px", cursor: "pointer", transition: "background .12s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#0c1a2e"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <Avatar initials={m.initials} size={36} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.white }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: C.dimmer, marginTop: 1 }}>{m.role}</div>
                    </div>
                    {m.leave
                      ? <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color={C.amber} pulse /><span style={{ fontSize: 11, color: C.amber }}>{m.leave}</span></div>
                      : <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color={C.green} /><span style={{ fontSize: 11, color: C.dim }}>Active</span></div>}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.dimmer} strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                  {i < members.length - 1 && <Divider />}
                </div>
              ))}
            </Card>
          );
        })}
      </div>
    </div>
  );
}


function TimeLogs({ timeLogs=[] }) {
  const [range, setRange] = useState("daily");
  const teamGroups = groupBy(timeLogs, "team");
  const missing = timeLogs.filter(t => !t.logged);
  const totalHours = timeLogs.reduce((s, m) => s + (m.h || 0), 0).toFixed(1);

  // Build team totals for bar chart
  const teamTotals = Object.entries(groupBy(timeLogs, 'team')).map(([team, members]) => ({
    team,
    hours: members.reduce((s, m) => s + (m.h || 0), 0),
    logged: members.filter(m => m.logged).length,
    total: members.length,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {["daily", "weekly", "monthly", "quarterly", "yearly", "custom"].map(r => (
          <button key={r} onClick={() => setRange(r)} style={{ background: range === r ? C.blue : "transparent", border: `1px solid ${range === r ? C.blue : C.border}`, color: range === r ? C.white : C.dim, borderRadius: 8, padding: "7px 18px", fontSize: 11, fontWeight: 600, cursor: "pointer", letterSpacing: "0.07em", textTransform: "uppercase" }}>{r}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
        {[
          { label: "Total Logged", val: `${totalHours}h`, color: C.white, sub: "This period" },
          { label: "On Target", val: `${timeLogs.filter(t => t.logged).length}/${timeLogs.length}`, color: C.green, sub: "Logged today" },
          { label: "Missing", val: missing.length, color: missing.length ? C.red : C.green, sub: "Need to log" }
        ].map(k => (
          <Card key={k.label}>
            <Label>{k.label}</Label>
            <BigNum value={k.val} color={k.color} />
            <div style={{ fontSize: 11, color: C.dimmer, marginTop: 6 }}>{k.sub}</div>
          </Card>
        ))}
      </div>
      {teamTotals.length > 0 && (
        <div style={{ background: '#0A1628', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(240,244,255,0.22)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }}>Hours Logged Today — By Team</div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={teamTotals} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <XAxis dataKey="team" tick={{ fill: 'rgba(240,244,255,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(240,244,255,0.45)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#070F1C', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v}h`, 'Hours']} />
              <RBar dataKey="hours" radius={[4,4,0,0]} fill="#1A6EF5">
                {teamTotals.map((t) => (
                  <Cell key={t.team} fill={t.logged === t.total ? '#1A9E6E' : t.logged === 0 ? '#E03E3E' : '#1A6EF5'} />
                ))}
              </RBar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {missing.length > 0 && (
        <div style={{ background: C.red + "12", border: `1px solid ${C.red}44`, borderRadius: 12, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Dot color={C.red} pulse />
            <span style={{ fontSize: 13, color: C.red }}>
              {missing.length === 1 ? missing[0].name : `${missing.length} members`} haven't logged time today
            </span>
          </div>
          <button style={{ background: C.red + "22", border: `1px solid ${C.red}55`, color: C.red, borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Send reminders</button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {Object.entries(teamGroups).map(([team, members]) => {
          const miss = members.filter(m => !m.logged).length;
          const teamTotal = members.reduce((s, m) => s + (m.h || 0), 0).toFixed(1);
          return (
            <Card key={team} style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.white }}>{team}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {miss > 0 && <span style={{ fontSize: 11, color: C.red }}>{miss} missing</span>}
                  <span style={{ fontSize: 12, color: C.blueLight, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700 }}>{teamTotal}h logged</span>
                </div>
              </div>
              <Divider />
              {members.map((m, i) => (
                <div key={m.name}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px" }}>
                    <Avatar initials={m.initials} size={30} />
                    <span style={{ width: 120, fontSize: 13, color: C.white, fontWeight: 500 }}>{m.name}</span>
                    {m.logged ? (
                      <>
                        <Bar pct={(m.h / 8) * 100} color={C.blue} h={5} />
                        <span style={{ fontSize: 12, color: C.blueLight, fontWeight: 600, width: 36, textAlign: "right" }}>{m.h}h</span>
                        <Dot color={C.green} />
                      </>
                    ) : (
                      <>
                        <div style={{ flex: 1 }} />
                        <span style={{ fontSize: 11, color: C.dimmer }}>Not logged</span>
                        <Dot color={C.red} pulse />
                      </>
                    )}
                  </div>
                  {i < members.length - 1 && <Divider />}
                </div>
              ))}
            </Card>
          );
        })}
      </div>
    </div>
  );
}


function Tickets({ tickets=[], onSelectTicket }) {
  const [projFilter, setProjFilter] = useState("");
  const projectsList = [...new Set(tickets.map(t=>t.project_name||'No Project'))].sort();
  
  const filteredTix = projFilter ? tickets.filter(t=>(t.project_name||'No Project')===projFilter) : tickets;
  const projectGroups = groupBy(filteredTix, "project_name");
  
  const overdueCount = filteredTix.filter(t => t.overdue).length;
  const blockedCount = filteredTix.filter(t => t.status === "Blocked").length;
  const reviewCount  = filteredTix.filter(t => t.status === "Review" || t.status === "In Review").length;

  const gridCol = "80px 60px 1.5fr 80px 100px 110px 80px 60px 60px 60px 60px 60px 70px 90px";
  const headers = ["ID", "BZ ID", "Title", "Created", "Author", "Assigned", "When", "DB", "Java", "JS/UI", "QA", "AI", "DevOps", "Mgr"];

  function fmtDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  }

  function renderName(name) {
    if (!name) return '-';
    const parts = name.split(' ');
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length-1][0]}.`;
  }

  // Status distribution for donut chart
  const statusCounts = ['In Progress','Review','Blocked','Todo'].map(s => ({
    name: s,
    value: filteredTix.filter(t => t.status === s).length,
    color: statusColor(s)
  })).filter(s => s.value > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {filteredTix.length > 0 && (
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', background: '#0A1628', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 24px', marginBottom: 4 }}>
          <ResponsiveContainer width={120} height={120}>
            <PieChart>
              <Pie data={statusCounts} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={2} dataKey="value">
                {statusCounts.map((s) => <Cell key={s.name} fill={s.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#070F1C', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {statusCounts.map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                <span style={{ fontSize: 12, color: 'rgba(240,244,255,0.45)' }}>{s.name}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F4FF', fontFamily: "'Barlow Condensed',sans-serif" }}>{s.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 32, fontWeight: 700, color: '#F0F4FF', lineHeight: 1 }}>{filteredTix.length}</div>
            <div style={{ fontSize: 10, color: 'rgba(240,244,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Total Open</div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, flex: 1, maxWidth: 800 }}>
          {[
            { label: "Open", val: filteredTix.length, color: C.white },
            { label: "Overdue", val: overdueCount, color: overdueCount ? C.red : C.green },
            { label: "Blocked", val: blockedCount, color: C.amber },
            { label: "Review", val: reviewCount, color: C.blueLight }
          ].map(k => (
            <Card key={k.label}><Label>{k.label}</Label><BigNum value={k.val} color={k.color} /></Card>
          ))}
        </div>
        <select value={projFilter} onChange={e=>setProjFilter(e.target.value)} style={{ padding: "10px 16px", borderRadius: 8, background: C.card, color: C.white, border: `1px solid ${C.borderHi}`, outline: "none", cursor: "pointer", fontWeight: 600 }}>
          <option value="">All Projects</option>
          {projectsList.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Object.entries(projectGroups).map(([proj, tix]) => {
          const od = tix.filter(t => t.overdue).length;
          return (
            <TeamAccordion key={proj} teamName={proj} count={`${tix.length} tickets`} meta={od > 0 ? `${od} overdue` : null}>
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 1000 }}>
                  <div style={{ display: "grid", gridTemplateColumns: gridCol, gap: 10, padding: "8px 10px", marginBottom: 4 }}>
                    {headers.map(h => (<div key={h} style={{ fontSize: 9, color: C.dimmer, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{h}</div>))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {tix.map((t, i) => (
                      <div key={t.id}>
                        <div style={{ display: "grid", gridTemplateColumns: gridCol, gap: 10, padding: "11px 10px", borderRadius: 8, transition: "background .12s", alignItems: "center" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#0c1a2e"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {t.overdue && <Dot color={C.red} pulse />}
                            <a href={`http://redmine.redmind.com/issues/${t.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.blueLight, letterSpacing: "0.06em", textDecoration: "none", fontWeight: 600 }}>#{t.id}</a>
                          </div>
                          
                          <div style={{ fontSize: 11, color: C.amber }}>{t.bz_id || '-'}</div>
                          <div onClick={() => onSelectTicket(t)} style={{ fontSize: 13, fontWeight: 600, color: C.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer" }}>{t.title}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>{fmtDate(t.created_at || t.start_date)}</div>
                          <div style={{ fontSize: 11, color: C.dimmer }}>{renderName(t.assigned_by)}</div>
                          <div style={{ fontSize: 12, color: C.white, fontWeight: 500 }}>{renderName(t.assigned_to)}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>{fmtDate(t.last_update)}</div>
                          
                          {/* Historical Team Columns */}
                          <div style={{ fontSize: 11, color: C.dim }}>{renderName(t.db_assignee)}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>{renderName(t.java_assignee)}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>{renderName(t.js_assignee)}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>{renderName(t.qa_assignee)}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>{renderName(t.ai_assignee)}</div>
                          <div style={{ fontSize: 11, color: C.dim }}>{renderName(t.devops_assignee)}</div>
                          
                          <div style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>{renderName(t.manager)}</div>
                        </div>
                        {i < tix.length - 1 && <Divider />}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </TeamAccordion>
          );
        })}
      </div>
    </div>
  );
}


function People({ people=[], onSelectPerson }) {
  const teamGroups = groupBy(people, "team");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Object.entries(teamGroups).map(([team, members]) => {
        const onL = members.filter(m => m.leave).length;
        return (
          <TeamAccordion key={team} teamName={team} count={`${members.length} members`} meta={onL > 0 ? `${onL} on leave` : null}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px 100px 100px 80px", gap: 16, padding: "8px 10px", marginBottom: 4 }}>
              {["Name", "Role", "Tickets", "Working", "Hours", "Status"].map(h => (<div key={h} style={{ fontSize: 9, color: C.dimmer, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{h}</div>))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {members.map((m, i) => {
                const pct = (m.worked / 45) * 100; const col = pct > 80 ? C.red : pct > 60 ? C.amber : C.blue;
                return (
                  <div key={m.id || i}>
                    <div onClick={() => onSelectPerson(m)} style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px 100px 100px 80px", gap: 16, padding: "11px 10px", cursor: "pointer", borderRadius: 8, transition: "background .12s", alignItems: "center" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#0c1a2e"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Avatar initials={m.initials} size={32} />
                        <div><div style={{ fontSize: 13, fontWeight: 600, color: C.white }}>{m.name}</div><div style={{ fontSize: 10, color: C.dimmer, marginTop: 1 }}>{m.team}</div></div>
                      </div>
                      <div style={{ fontSize: 12, color: C.dim }}>{m.role || 'Member'}</div>
                      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 700, color: C.blueLight }}>{m.tickets_created || 0}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Bar pct={((m.tickets_worked || 0) / 45) * 100} color={col} h={4} /><span style={{ fontSize: 11, color: col, fontWeight: 600, flexShrink: 0 }}>{m.tickets_worked || 0}</span></div>
                      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 700, color: C.green }}>{m.hours_this_month || 0}h</div>

                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {m.leave ? <><Dot color={C.amber} pulse /><span style={{ fontSize: 11, color: C.amber }}>{m.leave}</span></> : <><Dot color={C.green} /><span style={{ fontSize: 11, color: C.dim }}>Active</span></>}
                      </div>
                    </div>
                    {i < members.length - 1 && <Divider />}
                  </div>
                );
              })}
            </div>
          </TeamAccordion>
        );
      })}
    </div>
  );
}


const NAV_ICONS = {
  Overview: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>,
  Team:     <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="9" cy="7" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="18" cy="7" r="2.5"/><path d="M21 18c0-2.5-1.5-4.5-3.5-5.2"/></svg>,
  Time:     <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>,
  Tickets:  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
  People:   <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
  Admin:    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 9.36l-7.1 7.1a1 1 0 0 1-1.4 0l-2.8-2.8a1 1 0 0 1 0-1.4l7.1-7.1a6 6 0 0 1 9.36-7.94z"/></svg>,
};
const NAV_ITEMS = ["Overview","Team","Time","Tickets","People","Admin"];

function AdminTeamBlock({ team, members, unmapped, onAdd, onRemove, onToggleLead }) {
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.white }}>{team}</span>
        <span style={{ fontSize: 11, color: C.dimmer }}>{members.length} members</span>
      </div>
      <Divider />
      <div style={{ padding: "16px 20px", minHeight: 120 }}>
        <div style={{ position:"relative", marginBottom: 16 }}>
          <select value="" onChange={e => { if(e.target.value) onAdd(parseInt(e.target.value), team); }} 
                  style={{ width: "100%", padding: "10px 14px", background: C.surface, border: `1px solid ${C.border}`, color: C.dimmer, borderRadius: 8, cursor: "pointer", appearance: "none", fontSize: 13 }}>
            <option value="" disabled>+ Add Member</option>
            {unmapped.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <div style={{ position:"absolute", right:14, top:12, pointerEvents:"none" }}>
            <Chevron open={false}/>
          </div>
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {members.map(m => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: m.is_team_lead ? C.blue+"11" : C.bg, border: `1px solid ${m.is_team_lead ? C.blueLight+"44" : C.border}`, padding: "8px 12px", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar initials={m.initials} size={28} />
                <span style={{ fontSize: 13, color: m.is_team_lead ? C.blueLight : C.white, fontWeight: m.is_team_lead ? 600 : 500 }}>{m.name}</span>
                {m.is_team_lead && <div style={{ fontSize: 9, background: C.blueLight+"33", color: C.blueLight, padding: "2px 6px", borderRadius: 4, textTransform: "uppercase", fontWeight: 700 }}>Lead</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => onToggleLead(m.id, !m.is_team_lead)} style={{ background: "none", border: "none", color: m.is_team_lead ? C.amber : C.dimmer, fontSize: 11, cursor: "pointer" }}>{m.is_team_lead ? "Unmark" : "Lead"}</button>
                <div style={{ width: 1, height: 12, background: C.border }} />
                <button onClick={() => onRemove(m.id)} style={{ background: "none", border: "none", color: C.red, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Admin() {
  const [users, setUsers] = useState([]);
  const [inactive, setInactive] = useState([]);
  const [projects, setProjects] = useState([]);
  const [sheetUrl, setSheetUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/users').then(r=>r.json()),
      fetch('/api/admin/projects').then(r=>r.json())
    ]).then(([u, p]) => {
      setUsers(u.users || []);
      setInactive(u.inactive || []);
      setProjects(p.projects || []);
      setLoading(false);
    });
  }, []);

  const TEAMS = ["AI", "DB", "QA", "Java", "JS/UI", "DevOps", "Misc"];
  const unmapped = users.filter(u => !u.team);
  const managers = users.filter(u => u.role === 'Manager' || projects.some(p => p.manager_id === u.id));
  const nonManagers = users.filter(u => !managers.find(m => m.id === u.id));

  async function updateUser(id, field, val) {
    if (!id) return;
    const u = users.find(x=>x.id===id) || inactive.find(x=>x.id===id);
    if (!u) return;
    const updates = typeof field === 'object' ? field : { [field]: val };
    const body = { id, team: u.team, role: u.role, is_team_lead: u.is_team_lead, active: u.active, ...updates };
    if (updates.active === false) {
      setUsers(users.filter(x => x.id !== id));
      setInactive([...inactive, { ...u, ...updates, team: null, is_team_lead: false }].sort((a,b) => a.name.localeCompare(b.name)));
      body.team = null; body.is_team_lead = false;
    } else if (updates.active === true) {
      setInactive(inactive.filter(x => x.id !== id));
      setUsers([...users, { ...u, ...updates }].sort((a,b) => a.name.localeCompare(b.name)));
    } else {
      setUsers(users.map(x => x.id===id ? { ...x, ...updates } : x));
    }
    await fetch('/api/admin/users', { method: 'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  }

  async function updateProject(id, manager_id) {
    if (!id) return;
    setProjects(projects.map(x => x.id===id ? { ...x, manager_id } : x));
    await fetch('/api/admin/projects', { method: 'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, manager_id }) });
  }

  async function syncLeave() {
    if (!sheetUrl) return alert('Enter a Google Sheet CSV URL');
    const res = await fetch('/api/sync-leave', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: sheetUrl }) });
    const data = await res.json();
    if (res.ok) alert(`Synced ${data.records_added} leave records!`);
    else alert('Error: ' + data.error);
  }

  if (loading) return <div style={{ color: C.dim }}>Loading Admin...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      {/* Teams Mapping Card */}
      <Card style={{ padding: 24 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.05em", color: C.dimmer, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>Team Mapping & Leads</div>
        <div style={{ fontSize: 13, color: C.dim, marginBottom: 20 }}>Unmapped employees: <span style={{ color: unmapped.length > 0 ? C.amber : C.dimmer }}>{unmapped.length}</span></div>
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          {TEAMS.map(team => {
            const members = users.filter(u => u.team === team).sort((a,b)=> (b.is_team_lead?1:0) - (a.is_team_lead?1:0) || a.name.localeCompare(b.name));
            return (
              <AdminTeamBlock 
                key={team} 
                team={team} 
                members={members} 
                unmapped={unmapped}
                onAdd={(id, teamName) => updateUser(id, 'team', teamName)}
                onRemove={(id) => updateUser(id, { team: null, is_team_lead: false })}
                onToggleLead={(id, isLead) => updateUser(id, 'is_team_lead', isLead)}
              />
            );
          })}
        </div>
      </Card>

      {/* Project Managers Card */}
      <Card style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Label size={13}>Project Managers</Label>
          <select value="" onChange={e => updateUser(parseInt(e.target.value), 'role', 'Manager')} style={{ padding: "8px 16px", borderRadius: 8, background: C.blue, color: C.white, border: "none", outline: "none", cursor: "pointer", fontWeight: 600 }}>
            <option value="" disabled>+ Designate new Manager</option>
            {nonManagers.map(nm => <option key={nm.id} value={nm.id}>{nm.name}</option>)}
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          {managers.map(mgr => {
            const mProps = projects.filter(p => p.manager_id === mgr.id);
            const availProps = projects.filter(p => p.manager_id !== mgr.id);
            return (
              <div key={mgr.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.blueLight }}>{mgr.name}</div>
                  <button onClick={() => { updateUser(mgr.id, 'role', 'Member'); mProps.forEach(p => updateProject(p.id, null)); }} style={{ background: "none", border: `1px solid ${C.borderHi}`, color: C.dimmer, borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}>Remove Manager</button>
                </div>
                
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                  {mProps.length === 0 && <div style={{ fontSize: 11, color: C.dimmer, fontStyle: "italic", padding: "6px 8px" }}>No projects assigned</div>}
                  {mProps.map(p => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", background: C.card, borderRadius: 6 }}>
                      <span style={{ fontSize: 12, color: C.white }}>{p.name}</span>
                      <button onClick={() => updateProject(p.id, null)} style={{ background: "none", border: "none", color: C.dimmer, fontSize: 14, cursor: "pointer", lineHeight: 1 }}>&times;</button>
                    </div>
                  ))}
                </div>

                <div style={{ position:"relative" }}>
                  <select value="" onChange={e => updateProject(parseInt(e.target.value), mgr.id)} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, background: C.card, color: C.dim, border: `1px solid ${C.border}`, outline: "none", cursor: "pointer", appearance:"none" }}>
                    <option value="" disabled>+ Assign Project</option>
                    {availProps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div style={{ position:"absolute", right:12, top:10, pointerEvents:"none" }}><Chevron open={false}/></div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Unmapped Users Card */}
      {unmapped.length > 0 && (
        <Card style={{ padding: 24 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.05em", color: C.dimmer, textTransform: "uppercase", fontWeight: 700, marginBottom: 16 }}>Unmapped Users ({unmapped.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {unmapped.map(u => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.bg, border: `1px solid ${C.border}`, padding: "6px 10px", borderRadius: 8 }}>
                <Avatar initials={u.initials} size={24} />
                <span style={{ fontSize: 12, color: C.white }}>{u.name}</span>
                <button onClick={() => updateUser(u.id, { active: false })} title="Mark inactive" style={{ background: "none", border: "none", color: C.dimmer, fontSize: 14, cursor: "pointer", lineHeight: 1 }}>&times;</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Inactive Users Card */}
      <Card style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.05em", color: C.dimmer, textTransform: "uppercase", fontWeight: 700 }}>Inactive Users ({inactive.length})</div>
        </div>
        {inactive.length === 0 ? (
          <div style={{ fontSize: 12, color: C.dimmer, fontStyle: "italic" }}>No inactive users</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {inactive.map(u => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.bg, border: `1px solid ${C.border}`, padding: "6px 10px", borderRadius: 8, opacity: 0.6 }}>
                <Avatar initials={u.initials} size={24} />
                <span style={{ fontSize: 12, color: C.dim }}>{u.name}</span>
                <button onClick={() => updateUser(u.id, { active: true })} title="Reactivate" style={{ background: "none", border: "none", color: C.green, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Activate</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Google Sheets Sync Card */}
      <Card style={{ padding: 24 }}>
        <Label size={13}>Google Sheets Leave Sync</Label>
        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
          <input type="text" placeholder="https://docs.google.com/spreadsheets/.../export?format=csv" value={sheetUrl} onChange={e=>setSheetUrl(e.target.value)} style={{ flex: 1, padding: "10px 14px", borderRadius: 8, background: C.bg, border: `1px solid ${C.border}`, color: C.white }} />
          <button onClick={syncLeave} style={{ background: C.blue, color: C.white, border: "none", borderRadius: 8, padding: "0 20px", fontWeight: 600, cursor: "pointer" }}>Sync Leave</button>
        </div>
      </Card>
    </div>
  );
}

// ── ROOT EXPORT ───────────────────────────────────────────────────
export default function Dashboard({ onLogout }) {
  const [screen, setScreen] = useState("Overview");
  const [data, setData]     = useState({ overview: {}, people: [], tickets: [], timeLogs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [syncing, setSyncing] = useState(false);
  const fetchingRef = React.useRef(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Fetch all data
  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [ov, pe, ti, tl] = await Promise.all([
        fetch("/api/overview").then(r => r.json()),
        fetch("/api/people").then(r => r.json()),
        fetch("/api/tickets").then(r => r.json()),
        fetch("/api/timelogs").then(r => r.json()),
      ]);
      setData({
        overview: ov,
        people: pe.people || [],
        tickets: ti.tickets || [],
        timeLogs: tl.logs || [],
      });
    } catch (err) {
      console.error("Fetch failed:", err);
      setError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { 
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    fetchAll(); 
  }, []);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) await fetchAll();
      else alert("Sync failed. Check terminal logs.");
    } catch (err) {
      alert("Network error during sync.");
    } finally {
      setSyncing(false);
    }
  }

  const { overview, people, tickets, timeLogs } = data;

  const [person, setPerson] = useState(null);
  const [ticket, setTicket] = useState(null);

  return (
    <div style={{ fontFamily:"'Barlow',sans-serif", background:C.bg, minHeight:"100vh", color:C.white, display:"flex" }}>
      {/* ── MOBILE OVERLAY ── */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position:"fixed", inset:0, background:"rgba(3,11,21,0.7)", zIndex:199 }} />
      )}

      {/* ── SIDEBAR ── */}
      <div
        className={`sidebar${sidebarOpen ? ' open' : ''}`}
        style={{ width:C.sidebarW, flexShrink:0, background:C.surface, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", height:"100vh", position:isMobile?"fixed":"sticky", top:0, zIndex:isMobile?200:"auto", transform:isMobile && !sidebarOpen?`translateX(-${C.sidebarW}px)`:"translateX(0)", transition:"transform 0.2s ease" }}>
        {isMobile && (
          <button onClick={() => setSidebarOpen(false)} style={{ position:"absolute", top:16, right:16, background:"none", border:"none", color:C.dimmer, fontSize:20, cursor:"pointer" }}>✕</button>
        )}
        <div style={{ padding:"28px 24px 24px" }}>
          <div style={{ fontSize:9, color:C.dimmer, letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:4 }}>Command Centre</div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:20, fontWeight:700, color:C.white, letterSpacing:"-0.01em", lineHeight:1.1 }}>RedMine<br/>Dashboard</div>
        </div>
        <Divider/>
        <nav style={{ padding:"16px 12px", display:"flex", flexDirection:"column", gap:4, flex:1 }}>
          {NAV_ITEMS.map(item=>{
            const active = screen===item;
            return (
              <button key={item} onClick={()=>{ setScreen(item); if(isMobile) setSidebarOpen(false); }} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:10, border:"none", cursor:"pointer", background:active?"rgba(26,110,245,0.15)":"transparent", color:active?C.blue:C.dim, fontSize:13, fontWeight:600, letterSpacing:"0.01em", transition:"all .15s", textAlign:"left", width:"100%" }}
                onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="rgba(255,255,255,0.04)"; }}
                onMouseLeave={e=>{ if(!active) e.currentTarget.style.background="transparent"; }}>
                {NAV_ICONS[item]}{item}
                {active && <div style={{ marginLeft:"auto", width:4, height:4, borderRadius:"50%", background:C.blue }}/>}
              </button>
            );
          })}
        </nav>

        {/* ── LOGOUT ── */}
        <div style={{ padding:"16px 12px", borderTop:`1px solid ${C.border}` }}>
          <div style={{ fontSize:11, color:C.dimmer, marginBottom:8, paddingLeft:4 }}>22 Mar 2026 · Q1 — 11 days left</div>
          <button onClick={onLogout} style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"10px 14px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.dim, fontSize:12, fontWeight:600, cursor:"pointer", transition:"all .15s", fontFamily:"'Barlow',sans-serif" }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor=C.red+"66"; e.currentTarget.style.color=C.red; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.dim; }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign Out
          </button>
        </div>
      </div>

      {/* ── MAIN ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:isMobile?"auto":"hidden" }}>
        <div style={{ padding:isMobile?"12px 16px":"20px 32px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center" }}>
            {isMobile && (
              <button onClick={() => setSidebarOpen(o => !o)} style={{ background:"none", border:`1px solid ${C.border}`, color:C.white, borderRadius:8, padding:"8px 10px", cursor:"pointer", marginRight:12, display:"flex", flexDirection:"column", gap:4, alignItems:"center", justifyContent:"center" }}>
                <div style={{ width:18, height:2, background:C.white, borderRadius:1 }} />
                <div style={{ width:18, height:2, background:C.white, borderRadius:1 }} />
                <div style={{ width:18, height:2, background:C.white, borderRadius:1 }} />
              </button>
            )}
            <div>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:24, fontWeight:700, color:C.white, letterSpacing:"-0.01em" }}>{screen}</div>
              <div style={{ fontSize:11, color:C.dimmer, marginTop:2 }}>
                {screen==="Overview" && "Company pulse — today"}
                {screen==="Team"     && "Leave status by team"}
                {screen==="Time"     && "Time logging snapshot"}
                {screen==="Tickets"  && "Open issues tracker"}
                {screen==="People"   && "Team performance"}
                {screen==="Admin"    && "System configuration & data mapping"}
              </div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            <button onClick={handleSync} disabled={syncing} style={{ background:syncing?"transparent":C.card, border:`1px solid ${C.borderHi}`, color:syncing?C.dimmer:C.white, borderRadius:8, padding:"8px 16px", fontSize:12, fontWeight:600, cursor:syncing?"wait":"pointer", display:"flex", alignItems:"center", gap:8, transition:"all .15s" }}
              onMouseEnter={e=>{ if(!syncing){ e.currentTarget.style.background=C.surface; e.currentTarget.style.borderColor=C.blueLight; } }}
              onMouseLeave={e=>{ if(!syncing){ e.currentTarget.style.background=C.card; e.currentTarget.style.borderColor=C.borderHi; } }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation:syncing?"spin 1s linear infinite":"none" }}><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.92-10.44l5.58 5.58"/></svg>
              {syncing ? "Syncing Redmine..." : "Refresh Data"}
            </button>
            <Divider vertical/>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              {tickets.filter(t=>t.overdue).length>0 && (
                <div style={{ background:C.red+"18", border:`1px solid ${C.red}44`, borderRadius:8, padding:"6px 14px", display:"flex", alignItems:"center", gap:7 }}>
                  <Dot color={C.red} pulse/><span style={{ fontSize:12, color:C.red, fontWeight:600 }}>{tickets.filter(t=>t.overdue).length} overdue</span>
                </div>
              )}
              <Avatar initials="CE" size={36}/>
            </div>
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:isMobile?"16px":"28px 32px", position:"relative" }}>
          {loading && (
            <div style={{ position:"absolute", inset:0, background:C.bg+"99", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
                <div style={{ width:40, height:40, border:`3px solid ${C.blue}22`, borderTopColor:C.blue, borderRadius:"50%", animation:"spin 1s linear infinite" }}/>
                <div style={{ fontSize:13, color:C.blue, fontWeight:600 }}>Hydrating Dashboard...</div>
              </div>
            </div>
          )}
          {error && <div style={{ color:C.red, padding:20, background:C.red+"11", borderRadius:12, border:`1px solid ${C.red}33` }}>{error}</div>}
          
          {screen==="Overview" && <Overview overview={overview} people={people} tickets={tickets} timeLogs={timeLogs}/>}
          {screen==="Team"     && <TeamLeave people={people} onSelectPerson={setPerson}/>}
          {screen==="Time"     && <TimeLogs timeLogs={timeLogs}/>}
          {screen==="Tickets"  && <Tickets tickets={tickets} onSelectTicket={setTicket}/>}
          {screen==="People"   && <People people={people} onSelectPerson={setPerson}/>}
          {screen==="Admin"    && <Admin />}
        </div>

      </div>

      <PersonModal person={person} onClose={()=>setPerson(null)}/>
      <TicketModal ticket={ticket} onClose={()=>setTicket(null)}/>
    </div>
  );
}
