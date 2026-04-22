import React, { useState, useEffect } from "react";
import IntelligenceChat from "./IntelligenceChat";
import PinnedInsights from "./PinnedInsights";
import OneOnOnePrep from "./OneOnOnePrep";
import EscalationChain from "./EscalationChain";
import TeamHealth from "./TeamHealth";
import TeamCompare from "./TeamCompare";

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
  const hue = ((initials.charCodeAt(0)*7+initials.charCodeAt(1)*13)%60)+200;
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, background:`hsl(${hue},40%,14%)`, border:`1px solid hsl(${hue},40%,26%)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*.32, fontWeight:700, color:`hsl(${hue},70%,68%)`, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:"0.04em" }}>{initials}</div>
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

function TimeLogSection({ title, color, loggedByTeam={}, noLogByTeam={}, totalLogged=0, totalNotLogged=0, showBars }) {
  const [open, setOpen] = useState(false);
  const [openTeams, setOpenTeams] = useState({});
  const toggleTeam = (t) => setOpenTeams(prev => ({ ...prev, [t]: !prev[t] }));
  const allHours = Object.values(loggedByTeam).flatMap(members => members.map(m => m.hours));
  const maxHours = allHours.length > 0 ? Math.max(...allHours, 1) : 1;

  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:12, overflow:"hidden", marginBottom:12 }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 20px", background:C.card, cursor:"pointer" }}
        onMouseEnter={e=>e.currentTarget.style.background="#0c1a2e"} onMouseLeave={e=>e.currentTarget.style.background=C.card}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:700, color:C.white }}>{title}</div>
          <div style={{ fontSize:11, color:C.dimmer, marginTop:2 }}>
            <span style={{ color:C.green }}>{totalLogged} logged</span> · <span style={{ color }}>{totalNotLogged} not logged</span>
          </div>
        </div>
        <Chevron open={open}/>
      </div>
      {open && (
        <div style={{ padding:"12px 20px 16px", background:C.bg }}>
          {showBars && Object.keys(loggedByTeam || {}).length > 0 && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, letterSpacing:"0.12em", color:C.dimmer, textTransform:"uppercase", fontWeight:600, marginBottom:10 }}>Who Logged Time (by team)</div>
              {Object.entries(loggedByTeam).sort(([a],[b])=>a.localeCompare(b)).map(([team, members]) => (
                <div key={team} style={{ marginBottom:8 }}>
                  <div onClick={()=>toggleTeam("logged-"+team)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", padding:"6px 0" }}>
                    <span style={{ fontSize:12, fontWeight:600, color:C.white }}>{team}</span>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color:C.green, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:600 }}>{members.reduce((s,m)=>s+m.hours,0).toFixed(1)}h</span>
                      <span style={{ fontSize:10, color:C.dimmer }}>{members.length} people</span>
                      <Chevron open={openTeams["logged-"+team]}/>
                    </div>
                  </div>
                  {openTeams["logged-"+team] && (
                    <div style={{ display:"flex", flexDirection:"column", gap:4, paddingLeft:8, marginTop:4 }}>
                      {members.sort((a,b)=>b.hours-a.hours).map(m => (
                        <div key={m.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"4px 8px", background:C.card, borderRadius:6 }}>
                          <span style={{ fontSize:12, color:C.dim, width:120, flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.name}</span>
                          <div style={{ flex:1, background:"rgba(255,255,255,0.07)", borderRadius:99, height:6, overflow:"hidden" }}>
                            <div style={{ width:`${Math.min((m.hours/maxHours)*100,100)}%`, height:"100%", background:C.green, borderRadius:99, transition:"width .3s" }}/>
                          </div>
                          <span style={{ fontSize:11, color:C.green, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:600, minWidth:35, textAlign:"right" }}>{m.hours.toFixed(1)}h</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {Object.keys(noLogByTeam || {}).length > 0 && (
            <div>
              <div style={{ fontSize:10, letterSpacing:"0.12em", color:C.dimmer, textTransform:"uppercase", fontWeight:600, marginBottom:10 }}>Not Logged</div>
              {Object.entries(noLogByTeam).sort(([a],[b])=>a.localeCompare(b)).map(([team, members]) => (
                <div key={team} style={{ marginBottom:6 }}>
                  <div onClick={()=>toggleTeam("nolog-"+team)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", padding:"6px 0" }}>
                    <span style={{ fontSize:12, fontWeight:600, color:C.white }}>{team}</span>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color, fontWeight:600 }}>{members.length}</span>
                      <Chevron open={openTeams["nolog-"+team]}/>
                    </div>
                  </div>
                  {openTeams["nolog-"+team] && (
                    <div style={{ display:"flex", flexDirection:"column", gap:3, paddingLeft:8, marginTop:4 }}>
                      {members.map(m => (
                        <div key={m.id} style={{ padding:"5px 10px", background:C.card, borderRadius:6, fontSize:12, color:C.dim }}>{m.name}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {Object.keys(noLogByTeam || {}).length === 0 && (
            <div style={{ color:C.green, padding:12, textAlign:"center", fontSize:12 }}>Everyone logged time!</div>
          )}
        </div>
      )}
    </div>
  );
}

function NoTimeLogModal({ onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/no-timelog").then(r=>r.json()).then(d=>{ setData(d); setLoading(false); }).catch(()=>setLoading(false));
  }, []);
  if (!onClose) return null;

  function exportCSV(period) {
    if (!data) return;
    const src = period === "today" ? data.today : data.yesterday;
    let csv = "Team,Name,Status\n";
    Object.entries(src.no_log_by_team || {}).forEach(([team, members]) => {
      members.forEach(m => { csv += `"${team}","${m.name}","Not Logged"\n`; });
    });
    Object.entries(src.logged_by_team || {}).forEach(([team, members]) => {
      members.forEach(m => { csv += `"${team}","${m.name}","${m.hours}h"\n`; });
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `timelog-${period}-${new Date().toISOString().split("T")[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:28, width:"90%", maxWidth:700, maxHeight:"85vh", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:C.white }}>Time Log Status</div>
            <div style={{ fontSize:12, color:C.dimmer, marginTop:4 }}>{data ? `${data.total_users} team members tracked` : "Loading..."}</div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            {data && <button onClick={()=>exportCSV("today")} style={{ background:C.blue, color:C.white, border:"none", borderRadius:8, padding:"7px 14px", fontSize:11, fontWeight:600, cursor:"pointer" }}>CSV Today</button>}
            {data && <button onClick={()=>exportCSV("yesterday")} style={{ background:"none", border:`1px solid ${C.borderHi}`, color:C.white, borderRadius:8, padding:"7px 14px", fontSize:11, fontWeight:600, cursor:"pointer" }}>CSV Yesterday</button>}
            <button onClick={onClose} style={{ background:"none", border:`1px solid ${C.border}`, color:C.dim, borderRadius:8, padding:"7px 12px", cursor:"pointer", fontSize:14 }}>&times;</button>
          </div>
        </div>

        {/* Team summary strip */}
        {data && data.team_summary && (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
            {Object.entries(data.team_summary).sort(([a],[b])=>a.localeCompare(b)).map(([team, s]) => (
              <div key={team} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"6px 10px", fontSize:10 }}>
                <span style={{ color:C.white, fontWeight:600 }}>{team}</span>
                <span style={{ color:C.dimmer }}> · </span>
                <span style={{ color:C.green }}>{s.today_total.toFixed(1)}h</span>
                <span style={{ color:C.dimmer }}> today · </span>
                <span style={{ color:C.blueLight }}>{s.yesterday_total.toFixed(1)}h</span>
                <span style={{ color:C.dimmer }}> yest</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ flex:1, overflowY:"auto" }}>
          {loading && <div style={{ color:C.dimmer, padding:20 }}>Loading...</div>}
          {data && (
            <>
              <TimeLogSection
                title="Today's Time Log"
                color={C.amber}
                loggedByTeam={data.today.logged_by_team}
                noLogByTeam={data.today.no_log_by_team}
                totalLogged={data.today.total_logged}
                totalNotLogged={data.today.total_not_logged}
                showBars={true}
              />
              <TimeLogSection
                title="Yesterday's Time Log"
                color={C.red}
                loggedByTeam={data.yesterday.logged_by_team}
                noLogByTeam={data.yesterday.no_log_by_team}
                totalLogged={data.yesterday.total_logged}
                totalNotLogged={data.yesterday.total_not_logged}
                showBars={true}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkloadByTeam({ workload=[], memberHours=[], compact=false }) {
  const [openTeams, setOpenTeams] = useState({});
  const toggleTeam = (t) => setOpenTeams(prev => ({ ...prev, [t]: !prev[t] }));

  // Group memberHours by team
  const membersByTeam = {};
  for (const m of memberHours) {
    if (!m.team) continue;
    if (!membersByTeam[m.team]) membersByTeam[m.team] = [];
    membersByTeam[m.team].push({ id: m.id, name: m.name, hours: parseFloat(m.hours_today || 0), tickets: parseInt(m.open_tickets || 0) });
  }

  // Max hours for bar scaling
  const allHours = memberHours.map(m => parseFloat(m.hours_today || 0)).filter(h => h > 0);
  const maxHours = allHours.length > 0 ? Math.max(...allHours) : 8;

  if (compact) {
    return (
      <Card style={{ flex:1, minWidth:0, padding:"16px 18px" }}>
        <Label size={11}>Workload by Team</Label>
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:12 }}>
          {workload.length === 0 && <div style={{ color:C.dimmer, fontSize:13 }}>No team data</div>}
          {workload.map((w) => {
            const members = membersByTeam[w.team] || [];
            const teamHoursTotal = members.reduce((s, m) => s + m.hours, 0);
            return (
              <div key={w.team} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, padding:"6px 0" }}>
                <div style={{ display:"flex", flexDirection:"column", minWidth:0, flex:1 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:C.white, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{w.team}</span>
                  <span style={{ fontSize:10, color:C.dimmer }}>{w.member_count} members</span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2 }}>
                  <span style={{ fontSize:12, color:C.green, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:600 }}>{teamHoursTotal.toFixed(1)}h today</span>
                  <span style={{ fontSize:10, color:C.dim }}>avg {w.avg_tickets_per_person} tickets</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ padding:0, overflow:"hidden" }}>
      <div style={{ padding:"18px 22px 14px" }}><Label size={11}>Workload by Team</Label></div>
      <Divider/>
      <div style={{ padding:"4px 0" }}>
        {workload.length === 0 && <div style={{ padding:20, color:C.dimmer, fontSize:13 }}>No team data available</div>}
        {workload.map((w, i) => {
          const pct = (w.avg_tickets_per_person / 10) * 100;
          const col = pct > 80 ? C.red : pct > 60 ? C.amber : C.blue;
          const members = membersByTeam[w.team] || [];
          const teamHoursTotal = members.reduce((s, m) => s + m.hours, 0);
          const isOpen = openTeams[w.team];

          return (
            <div key={w.team}>
              <div onClick={() => toggleTeam(w.team)} style={{ padding:"12px 22px", cursor:"pointer", transition:"background .15s" }}
                onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.03)"}
                onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:C.white }}>{w.team}</span>
                    <span style={{ fontSize:10, color:C.dimmer, background:C.card, padding:"2px 8px", borderRadius:4 }}>{w.member_count} members</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                    <span style={{ fontSize:11, color:C.green, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:600 }}>{teamHoursTotal.toFixed(1)}h today</span>
                    <span style={{ fontSize:11, color:col, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700 }}>avg {w.avg_tickets_per_person} tickets</span>
                    <Chevron open={isOpen}/>
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <Bar pct={pct} color={col} h={4}/>
                </div>
              </div>

              {isOpen && members.length > 0 && (
                <div style={{ padding:"0 22px 14px", background:C.bg }}>
                  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {members.sort((a, b) => b.hours - a.hours).map(m => (
                      <div key={m.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"5px 10px", background:C.card, borderRadius:6 }}>
                        <span style={{ fontSize:12, color:C.dim, width:130, flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.name}</span>
                        <div style={{ flex:1, background:"rgba(255,255,255,0.07)", borderRadius:99, height:6, overflow:"hidden" }}>
                          <div style={{ width:`${Math.min((m.hours / maxHours) * 100, 100)}%`, height:"100%", background: m.hours > 0 ? C.green : C.red+"44", borderRadius:99, transition:"width .3s" }}/>
                        </div>
                        <span style={{ fontSize:11, color: m.hours > 0 ? C.green : C.red, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:600, minWidth:35, textAlign:"right" }}>{m.hours > 0 ? m.hours.toFixed(1) + "h" : "—"}</span>
                        <span style={{ fontSize:10, color:C.dimmer, minWidth:45, textAlign:"right" }}>{m.tickets} tix</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {i < workload.length - 1 && <Divider/>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ExecSnapshotBlock({ title, rows=[] }) {
  return (
    <Card style={{ flex:1, minWidth:0, padding:"16px 18px" }}>
      <Label size={11}>{title}</Label>
      {rows.length === 0
        ? <div style={{ color:C.dimmer, fontSize:12, paddingTop:8 }}>No data</div>
        : <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:8 }}>
            {rows.map((r,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", borderBottom:i<rows.length-1?`1px solid ${C.border}`:"none" }}>
                <span style={{ fontSize:12, color:C.white, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{r.name || '—'}</span>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:18, fontWeight:700, color:C.blueLight, flexShrink:0, marginLeft:12 }}>{r.count}</span>
              </div>
            ))}
          </div>
      }
    </Card>
  );
}

function Overview({ overview={}, people=[], tickets=[], timeLogs=[], currentUser=null }) {
  const { kpis={}, workload=[] } = overview;

  const [execSnapshot, setExecSnapshot] = useState(null);
  useEffect(() => {
    fetch('/api/pm-pulse/executive-snapshot').then(r => r.json()).then(setExecSnapshot).catch(() => {});
  }, []);
  const [showNoTimeLog, setShowNoTimeLog] = useState(false);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:24, animation:"fadeIn .4s ease" }}>
      {/* ── PINNED INSIGHTS ── */}
      <PinnedInsights currentUser={currentUser}/>

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
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:16 }}>
        <Card>
          <Label>Headcount</Label>
          <BigNum value={`${(kpis.headcount || 0) - (kpis.on_leave || 0)} / ${kpis.headcount || 0}`} color={C.white}/>
          <div style={{ fontSize:11, color:C.dimmer, marginTop:6 }}>Present / Assigned</div>
        </Card>
        <Card>
          <Label>On Leave</Label>
          <BigNum value={kpis.on_leave || 0} color={C.amber}/>
          <div style={{ fontSize:11, color:C.dimmer, marginTop:6 }}>Today</div>
        </Card>
        <Card>
          <Label>Yesterday Hours</Label>
          <BigNum value={parseFloat(kpis.yesterday_hours || 0).toFixed(1)} color={C.green} size={32}/>
          <div style={{ fontSize:11, color:C.dimmer, marginTop:6 }}>Total logged</div>
        </Card>
        <Card>
          <Label>Overdue</Label>
          <BigNum value={kpis.overdue_tickets || 0} color={C.red}/>
          <div style={{ fontSize:11, color:C.dimmer, marginTop:6 }}>Need attention</div>
        </Card>
        <Card onClick={()=>setShowNoTimeLog(true)} style={{ cursor:"pointer" }}>
          <Label>No Time Log</Label>
          <BigNum value={kpis.no_time_log || 0} color={C.amber}/>
          <div style={{ fontSize:11, color:C.blueLight, marginTop:6 }}>Click to view &rarr;</div>
        </Card>
      </div>
      {showNoTimeLog && <NoTimeLogModal onClose={()=>setShowNoTimeLog(false)}/>}

      {/* ── EXECUTIVE SNAPSHOT + WORKLOAD (4-col) ── */}
      <div>
        <div style={{ fontSize:11, letterSpacing:"0.12em", color:C.dimmer, textTransform:"uppercase", fontWeight:600, marginBottom:14 }}>Executive Snapshot — Active Tickets</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:16 }}>
          <ExecSnapshotBlock title="By Manager" rows={execSnapshot?.managers||[]}/>
          <ExecSnapshotBlock title="By Project" rows={execSnapshot?.projects||[]}/>
          <ExecSnapshotBlock title="By Developer" rows={execSnapshot?.developers||[]}/>
          <WorkloadByTeam workload={workload} memberHours={overview.memberHours || []} compact/>
        </div>
      </div>

      {/* ── TEAM HEALTH BADGES ── */}
      <TeamHealth currentUser={currentUser}/>

      {/* ── ESCALATION CHAIN ── */}
      <EscalationChain currentUser={currentUser}/>
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
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Object.entries(teamGroups).map(([team, members]) => {
          const onL = members.filter(m => m.leave).length;
          return (
            <TeamAccordion key={team} teamName={team} count={`${members.length} members`} meta={onL > 0 ? `${onL} on leave` : null}>
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
            </TeamAccordion>
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
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Object.entries(teamGroups).map(([team, members]) => {
          const miss = members.filter(m => !m.logged).length;
          const teamTotal = members.reduce((s, m) => s + (m.h || 0), 0).toFixed(1);
          return (
            <TeamAccordion key={team} teamName={team} count={`${teamTotal}h logged`} meta={miss > 0 ? `${miss} missing` : null}>
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
            </TeamAccordion>
          );
        })}
      </div>
    </div>
  );
}


const BUCKETS = ["All", "iCLAIMS 2.0", "Reports 3.0", "Maya Virtual Agent & Sub", "Miscellaneous"];

function getProjectBucket(projectName) {
  const MAYA = ['Maya Virtual Assistant','Claim Info Bot','Maya Agents','Maya Audits / Assistance','Maya Charts','Maya Docs','Maya Insights','Maya Predictions','Maya Voice','Producer App','Support Bot'];
  if (projectName === 'iCLAIMS 2.0') return 'iCLAIMS 2.0';
  if (projectName === 'Reports 3.0') return 'Reports 3.0';
  if (MAYA.includes(projectName)) return 'Maya Virtual Agent & Sub';
  return 'Miscellaneous';
}

function AnomalySection({ title, rows=[], columns=[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:12, overflow:"hidden" }}>
      <div onClick={() => setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 20px", background:C.card, cursor:"pointer" }}
        onMouseEnter={e=>e.currentTarget.style.background="#0c1a2e"}
        onMouseLeave={e=>e.currentTarget.style.background=C.card}>
        <Chevron open={open}/>
        <span style={{ fontSize:13, fontWeight:600, color:C.white }}>{title}</span>
        <span style={{ marginLeft:"auto", background:rows.length?C.amber+"22":C.border, border:`1px solid ${rows.length?C.amber+"55":C.border}`, borderRadius:20, padding:"2px 10px", fontSize:11, color:rows.length?C.amber:C.dimmer, fontWeight:600 }}>{rows.length}</span>
      </div>
      {open && (
        <div style={{ padding:"0 0 8px" }}>
          {rows.length === 0
            ? <div style={{ padding:"16px 20px", color:C.dimmer, fontSize:12 }}>No issues found.</div>
            : (
              <div style={{ overflowX:"auto" }}>
                <div style={{ minWidth:900, padding:"0 10px" }}>
                  <div style={{ display:"grid", gridTemplateColumns:columns.map(()=>"1fr").join(" "), gap:10, padding:"8px 10px", marginBottom:2 }}>
                    {columns.map(c=><div key={c} style={{ fontSize:9, color:C.dimmer, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:600 }}>{c}</div>)}
                  </div>
                  {rows.map((r,i)=>(
                    <div key={i} style={{ display:"grid", gridTemplateColumns:columns.map(()=>"1fr").join(" "), gap:10, padding:"10px 10px", borderRadius:8, borderBottom:i<rows.length-1?`1px solid ${C.border}`:"none", alignItems:"center" }}
                      onMouseEnter={e=>e.currentTarget.style.background="#0c1a2e"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      {r}
                    </div>
                  ))}
                </div>
              </div>
            )
          }
        </div>
      )}
    </div>
  );
}

function Tickets({ tickets=[], onSelectTicket }) {
  const [bucket, setBucket] = useState("All");
  const [anomalies, setAnomalies] = useState(null);

  useEffect(() => {
    fetch('/api/pm-pulse/anomalies').then(r => r.json()).then(setAnomalies).catch(() => {});
  }, []);

  const filteredTix = bucket === "All"
    ? tickets
    : tickets.filter(t => getProjectBucket(t.project_name || '') === bucket);

  const projectGroups = groupBy(filteredTix, "project_name");
  const overdueCount = filteredTix.filter(t => t.overdue).length;
  const blockedCount = filteredTix.filter(t => t.status === "Blocked").length;
  const reviewCount  = filteredTix.filter(t => t.status === "Review" || t.status === "In Review").length;

  // AppScript column layout (projectSheetHeaders — exact labels)
  const gridCol = "80px 70px 1.8fr 90px 95px 95px 95px 90px 1fr 100px";
  const headers = ["Redmine No", "BZ Id", "Brief description", "Status", "Created date", "Last update date", "Assigned to", "Due Date", "Team members who worked on it", "Manager"];

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' });
  }
  function renderName(name) {
    if (!name) return '—';
    const parts = name.split(' ');
    return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length-1][0]}.`;
  }

  const anomCols = {
    reopen:            ["Project", "Redmine #", "Brief Description", "Assigned To", "Last Updated", "Manager"],
    stale:             ["Project", "Redmine #", "Brief Description", "Status", "Assigned To", "Last Updated", "Days Since Update", "Manager"],
    workedNotAssigned: ["Project", "Redmine #", "Brief Description", "Assigned To", "Worked By", "Hours Logged", "Last Log Date", "Manager"],
    assignedNoTime:    ["Project", "Redmine #", "Brief Description", "Status", "Assigned To", "Due Date", "Last Updated", "Manager"],
  };

  function anomRow_reopen(r) {
    return [
      <span style={{fontSize:12,color:C.dim}}>{r.project_name||'—'}</span>,
      <a href={`http://redmine.redmind.com/issues/${r.redmine_id}`} target="_blank" rel="noreferrer" style={{fontSize:11,color:C.blueLight,textDecoration:"none",fontWeight:600}}>#{r.redmine_id}</a>,
      <span style={{fontSize:12,color:C.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</span>,
      <span style={{fontSize:12,color:C.white}}>{renderName(r.assigned_to)}</span>,
      <span style={{fontSize:11,color:C.dim}}>{fmtDate(r.updated_at)}</span>,
      <span style={{fontSize:12,color:C.green}}>{renderName(r.manager)}</span>,
    ];
  }
  function anomRow_stale(r) {
    return [
      <span style={{fontSize:12,color:C.dim}}>{r.project_name||'—'}</span>,
      <a href={`http://redmine.redmind.com/issues/${r.redmine_id}`} target="_blank" rel="noreferrer" style={{fontSize:11,color:C.blueLight,textDecoration:"none",fontWeight:600}}>#{r.redmine_id}</a>,
      <span style={{fontSize:12,color:C.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</span>,
      <StatusPill status={r.status}/>,
      <span style={{fontSize:12,color:C.white}}>{renderName(r.assigned_to)}</span>,
      <span style={{fontSize:11,color:C.dim}}>{fmtDate(r.updated_at)}</span>,
      <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:700,color:C.red}}>{r.days_since_update}</span>,
      <span style={{fontSize:12,color:C.green}}>{renderName(r.manager)}</span>,
    ];
  }
  function anomRow_worked(r) {
    return [
      <span style={{fontSize:12,color:C.dim}}>{r.project_name||'—'}</span>,
      <a href={`http://redmine.redmind.com/issues/${r.redmine_id}`} target="_blank" rel="noreferrer" style={{fontSize:11,color:C.blueLight,textDecoration:"none",fontWeight:600}}>#{r.redmine_id}</a>,
      <span style={{fontSize:12,color:C.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</span>,
      <span style={{fontSize:12,color:C.dim}}>{renderName(r.assigned_to)}</span>,
      <span style={{fontSize:12,color:C.amber,fontWeight:600}}>{renderName(r.worked_by)}</span>,
      <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:700,color:C.blueLight}}>{(r.hours_logged||0).toFixed(1)}h</span>,
      <span style={{fontSize:11,color:C.dim}}>{fmtDate(r.last_log_date)}</span>,
      <span style={{fontSize:12,color:C.green}}>{renderName(r.manager)}</span>,
    ];
  }
  function anomRow_notime(r) {
    return [
      <span style={{fontSize:12,color:C.dim}}>{r.project_name||'—'}</span>,
      <a href={`http://redmine.redmind.com/issues/${r.redmine_id}`} target="_blank" rel="noreferrer" style={{fontSize:11,color:C.blueLight,textDecoration:"none",fontWeight:600}}>#{r.redmine_id}</a>,
      <span style={{fontSize:12,color:C.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</span>,
      <StatusPill status={r.status}/>,
      <span style={{fontSize:12,color:C.white}}>{renderName(r.assigned_to)}</span>,
      <span style={{fontSize:11,color:r.due_date&&new Date(r.due_date)<new Date()?C.red:C.dim}}>{fmtDate(r.due_date)}</span>,
      <span style={{fontSize:11,color:C.dim}}>{fmtDate(r.updated_at)}</span>,
      <span style={{fontSize:12,color:C.green}}>{renderName(r.manager)}</span>,
    ];
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, maxWidth: 800 }}>
        {[
          { label: "Open", val: filteredTix.length, color: C.white },
          { label: "Overdue", val: overdueCount, color: overdueCount ? C.red : C.green },
          { label: "Blocked", val: blockedCount, color: C.amber },
          { label: "Review", val: reviewCount, color: C.blueLight }
        ].map(k => (
          <Card key={k.label}><Label>{k.label}</Label><BigNum value={k.val} color={k.color} /></Card>
        ))}
      </div>

      {/* Bucket filter pills */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {BUCKETS.map(b => (
          <button key={b} onClick={()=>setBucket(b)} style={{ background:bucket===b?C.blue:"transparent", border:`1px solid ${bucket===b?C.blue:C.border}`, color:bucket===b?C.white:C.dim, borderRadius:20, padding:"6px 16px", fontSize:11, fontWeight:600, cursor:"pointer", transition:"all .15s", letterSpacing:"0.04em" }}>
            {b === "All" ? `All (${tickets.length})` : `${b} (${tickets.filter(t=>getProjectBucket(t.project_name||'')===b).length})`}
          </button>
        ))}
      </div>

      {/* Project accordions with AppScript columns */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Object.entries(projectGroups).map(([proj, tix]) => {
          const od = tix.filter(t => t.overdue).length;
          return (
            <TeamAccordion key={proj} teamName={proj} count={`${tix.length} tickets`} meta={od > 0 ? `${od} overdue` : null}>
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 1100 }}>
                  <div style={{ display: "grid", gridTemplateColumns: gridCol, gap: 10, padding: "8px 10px", marginBottom: 4 }}>
                    {headers.map(h => (<div key={h} style={{ fontSize: 9, color: C.dimmer, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{h}</div>))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {tix.map((t, i) => {
                      const rowBg = t.overdue ? C.red+"12" : (t.due_date && (new Date(t.due_date)-new Date())/86400000 <= 3 && (new Date(t.due_date)-new Date())/86400000 >= 0) ? C.red+"08" : "transparent";
                      const assignedStyle = !t.assigned_to ? { background:C.amber+"22", border:`1px solid ${C.amber}44`, borderRadius:6, padding:"2px 8px" } : {};
                      return (
                        <div key={t.id}>
                          <div style={{ display: "grid", gridTemplateColumns: gridCol, gap: 10, padding: "11px 10px", borderRadius: 8, background:rowBg, alignItems: "center", transition:"background .12s" }}
                            onMouseEnter={e => { if(!rowBg||rowBg==="transparent") e.currentTarget.style.background="#0c1a2e"; }}
                            onMouseLeave={e => { e.currentTarget.style.background=rowBg; }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {t.overdue && <Dot color={C.red} pulse />}
                              <a href={`http://redmine.redmind.com/issues/${t.redmine_id||t.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.blueLight, textDecoration: "none", fontWeight: 600 }}>#{t.redmine_id||t.id}</a>
                            </div>
                            <div style={{ fontSize: 11, color: C.amber }}>{t.bz_id || '—'}</div>
                            <div onClick={() => onSelectTicket(t)} style={{ fontSize: 13, fontWeight: 600, color: C.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer" }}>{t.title}</div>
                            <StatusPill status={t.status}/>
                            <div style={{ fontSize: 11, color: C.dim }}>{fmtDate(t.created_at)}</div>
                            <div style={{ fontSize: 11, color: C.dim }}>{fmtDate(t.updated_at || t.last_update)}</div>
                            <div style={{ fontSize: 12, color: C.white, fontWeight: 500, ...assignedStyle }}>{t.assigned_to ? renderName(t.assigned_to) : 'Unassigned'}</div>
                            <div style={{ fontSize: 11, color: t.overdue ? C.red : (t.due_date && (new Date(t.due_date)-new Date())/86400000 <= 3 && (new Date(t.due_date)-new Date())/86400000 >= 0 ? C.amber : C.dim), fontWeight: t.overdue ? 600 : 400 }}>{fmtDate(t.due_date)}</div>
                            <div style={{ fontSize: 11, color: C.dimmer, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.contributors || '—'}</div>
                            <div style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>{renderName(t.manager)}</div>
                          </div>
                          {i < tix.length - 1 && <Divider />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </TeamAccordion>
          );
        })}
      </div>

      {/* ── ANOMALY SECTIONS ── */}
      {anomalies && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ fontSize:11, letterSpacing:"0.12em", color:C.dimmer, textTransform:"uppercase", fontWeight:600, marginTop:8, marginBottom:2 }}>Exception Views</div>
          <AnomalySection
            title="Reopen Watch"
            rows={(anomalies.reopen||[]).map(anomRow_reopen)}
            columns={anomCols.reopen}
          />
          <AnomalySection
            title="No Update in 3+ Days"
            rows={(anomalies.stale||[]).map(anomRow_stale)}
            columns={anomCols.stale}
          />
          <AnomalySection
            title="Worked But Not Assigned"
            rows={(anomalies.workedNotAssigned||[]).map(anomRow_worked)}
            columns={anomCols.workedNotAssigned}
          />
          <AnomalySection
            title="Assigned But No Time Logged"
            rows={(anomalies.assignedNoTime||[]).map(anomRow_notime)}
            columns={anomCols.assignedNoTime}
          />
        </div>
      )}
    </div>
  );
}


function People({ people=[], overview={}, onSelectPerson, onPrepOneOnOne }) {
  const EXPECTED_TIME_TEAMS = ['AI','DB','DevOps','JS/UI','Java','QA'];
  const [devLoad, setDevLoad] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState('All');
  const [timeLogFilter, setTimeLogFilter] = useState('All');

  useEffect(() => {
    fetch('/api/pm-pulse/developer-load').then(r => r.json()).then(setDevLoad).catch(() => {});
  }, []);

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  }

  // Team card aggregates (from workload + memberHours in overview)
  const workload = overview.workload || [];
  const memberHours = overview.memberHours || [];
  const timeLogData = devLoad?.timeLog || [];

  // Build per-team stats for the cards strip
  const teamStats = EXPECTED_TIME_TEAMS.map(team => {
    const wl = workload.find(w => w.team === team) || {};
    const members = memberHours.filter(m => m.team === team);
    const hoursToday = members.reduce((s, m) => s + parseFloat(m.hours_today || 0), 0);
    const teamTimeLog = timeLogData.filter(r => r.team === team);
    const logged = teamTimeLog.filter(r => r.logging_status === 'Logged Recently').length;
    const compliance = teamTimeLog.length > 0 ? Math.round((logged / teamTimeLog.length) * 100) : 0;
    return {
      team,
      members: wl.member_count || members.length,
      openTickets: wl.open_tickets || 0,
      hoursToday,
      compliance,
      onLeave: people.filter(p => p.team === team && p.leave).length,
    };
  });

  // Apply team filter to everything below
  const teamGroups = selectedTeam === 'All'
    ? groupBy(people.filter(p => EXPECTED_TIME_TEAMS.includes(p.team)), "team")
    : { [selectedTeam]: people.filter(p => p.team === selectedTeam) };

  const loadRows = (devLoad?.load || []).filter(r => selectedTeam === 'All' ? EXPECTED_TIME_TEAMS.includes(r.team) : r.team === selectedTeam);
  const timeLogRowsByTeam = timeLogData.filter(r => selectedTeam === 'All' ? EXPECTED_TIME_TEAMS.includes(r.team) : r.team === selectedTeam);
  const timeLogRows = timeLogFilter === 'All'
    ? timeLogRowsByTeam
    : timeLogRowsByTeam.filter(r => r.logging_status === timeLogFilter);

  const TEAM_PILLS = ['All', ...EXPECTED_TIME_TEAMS];
  const STATUS_PILLS = ['All', 'Logged Recently', 'No Log in 3+ Days', 'No Log This Week'];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── TEAM CARDS STRIP ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:10 }}>
        {teamStats.map(t => {
          const selected = selectedTeam === t.team;
          const complianceColor = t.compliance >= 80 ? C.green : t.compliance >= 50 ? C.amber : C.red;
          return (
            <Card
              key={t.team}
              onClick={() => setSelectedTeam(selected ? 'All' : t.team)}
              style={{
                cursor:"pointer",
                padding:"12px 14px",
                border: selected ? `2px solid ${C.blue}` : `1px solid ${C.border}`,
                background: selected ? C.blue + "12" : C.card,
                transition:"all .15s",
              }}
            >
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <span style={{ fontSize:13, fontWeight:700, color:C.white }}>{t.team}</span>
                {t.onLeave > 0 && <span style={{ fontSize:9, color:C.amber, background:C.amber+"22", borderRadius:4, padding:"1px 5px", fontWeight:600 }}>{t.onLeave} away</span>}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.dimmer, marginBottom:2 }}>
                <span>{t.members} members</span>
                <span>{t.openTickets} tickets</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginTop:6 }}>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:22, fontWeight:700, color:C.green }}>{t.hoursToday.toFixed(1)}h</span>
                <span style={{ fontSize:10, color:complianceColor, fontWeight:600 }}>{t.compliance}% logged</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* ── FILTER BAR (reflects current selection) ── */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:10, color:C.dimmer, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:600, marginRight:4 }}>Team:</span>
        {TEAM_PILLS.map(b => (
          <button key={b} onClick={()=>setSelectedTeam(b)} style={{ background:selectedTeam===b?C.blue:"transparent", border:`1px solid ${selectedTeam===b?C.blue:C.border}`, color:selectedTeam===b?C.white:C.dim, borderRadius:20, padding:"5px 14px", fontSize:11, fontWeight:600, cursor:"pointer", transition:"all .15s", letterSpacing:"0.04em" }}>
            {b}
          </button>
        ))}
      </div>

      {/* ── MEMBERS ACCORDIONS (filtered by team) ── */}
      {Object.entries(teamGroups).map(([team, members]) => {
        const onL = members.filter(m => m.leave).length;
        return (
          <TeamAccordion key={team} teamName={team} count={`${members.length} members`} meta={onL > 0 ? `${onL} on leave` : null}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px 100px 100px 80px 90px", gap: 16, padding: "8px 10px", marginBottom: 4 }}>
              {["Name", "Role", "Tickets", "Working", "Hours", "Status", ""].map(h => (<div key={h} style={{ fontSize: 9, color: C.dimmer, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{h}</div>))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {members.map((m, i) => {
                const pct = (m.worked / 45) * 100; const col = pct > 80 ? C.red : pct > 60 ? C.amber : C.blue;
                return (
                  <div key={m.id || i}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px 100px 100px 80px 90px", gap: 16, padding: "11px 10px", cursor: "pointer", borderRadius: 8, transition: "background .12s", alignItems: "center" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#0c1a2e"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div onClick={() => onSelectPerson(m)} style={{ display: "flex", alignItems: "center", gap: 12 }}>
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

                      <button
                        onClick={e => { e.stopPropagation(); onPrepOneOnOne && onPrepOneOnOne(m); }}
                        style={{
                          background: C.blue+"18", border: `1px solid ${C.blue}44`,
                          color: C.blueLight, borderRadius: 6, padding: "5px 10px",
                          fontSize: 10, fontWeight: 600, cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 4,
                          fontFamily: "'Barlow', sans-serif", transition: "all .15s",
                          letterSpacing: "0.02em",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = C.blue+"33"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = C.blue+"18"; }}
                      >
                        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 1 7 7v1a7 7 0 0 1-14 0V9a7 7 0 0 1 7-7z"/><path d="M8 21h8M12 17v4"/></svg>
                        1-on-1
                      </button>
                    </div>
                    {i < members.length - 1 && <Divider />}
                  </div>
                );
              })}
            </div>
          </TeamAccordion>
        );
      })}

      {/* ── DEVELOPER WORKLOAD SECTIONS ── */}
      {devLoad && (
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:8 }}>
          <div style={{ fontSize:11, letterSpacing:"0.12em", color:C.dimmer, textTransform:"uppercase", fontWeight:600, marginBottom:2 }}>Developer Workload{selectedTeam !== 'All' ? ` — ${selectedTeam}` : ''}</div>

          {/* Developer Load */}
          <AnomalySection
            title={`Developer Load (${loadRows.length})`}
            rows={loadRows.map(r => {
              const isOverloaded = r.total > 8;
              const rowStyle = isOverloaded ? { background:C.amber+"15", borderRadius:6, padding:"2px 6px" } : {};
              return [
                <span style={{ fontSize:12, color:C.white, fontWeight:600 }}>{r.name}</span>,
                <span style={{ fontSize:11, color:C.dim }}>{r.team}</span>,
                <span style={{ fontSize:11, color:C.dim }}>{r.manager||'—'}</span>,
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:18, fontWeight:700, color:isOverloaded?C.amber:C.blueLight, ...rowStyle }}>{r.total}</span>,
                <span style={{ fontSize:11, color:C.dimmer }}>{r.new_count}</span>,
                <span style={{ fontSize:11, color:C.blueLight }}>{r.in_progress_count}</span>,
                <span style={{ fontSize:11, color:C.amber }}>{r.reopen_count}</span>,
                <span style={{ fontSize:11, color:r.overdue?C.red:C.dimmer, fontWeight:r.overdue?700:400 }}>{r.overdue}</span>,
                <span style={{ fontSize:11, color:r.due_soon?C.amber:C.dimmer }}>{r.due_soon}</span>,
                <span style={{ fontSize:11, color:r.high_priority?C.red:C.dimmer }}>{r.high_priority}</span>,
                <span style={{ fontSize:10, color:C.dimmer, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.projects||'—'}</span>,
                <span style={{ fontSize:11, color:C.dim }}>{fmtDate(r.oldest_ticket_date)}</span>,
                <span style={{ fontSize:11, color:C.dim }}>{fmtDate(r.latest_update)}</span>,
              ];
            })}
            columns={["Developer","Team","Manager","Total","New","In Progress","Re Open","Overdue","Due Soon","High Priority","Projects","Oldest","Latest Update"]}
          />

          {/* Ageing by Developer */}
          <AnomalySection
            title={`Ageing by Developer (${loadRows.length})`}
            rows={loadRows.map(r => [
              <span style={{ fontSize:12, color:C.white, fontWeight:600 }}>{r.name}</span>,
              <span style={{ fontSize:11, color:C.dim }}>{r.manager||'—'}</span>,
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, color:C.blueLight }}>{r.total}</span>,
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, color:r.avg_age_days>10?C.amber:C.dim }}>{r.avg_age_days||0}</span>,
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, color:r.max_age_days>15?C.red:C.dim }}>{r.max_age_days||0}</span>,
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, color:r.tickets_7plus?C.amber:C.dimmer }}>{r.tickets_7plus||0}</span>,
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, color:r.tickets_15plus?C.red:C.dimmer }}>{r.tickets_15plus||0}</span>,
            ])}
            columns={["Developer","Manager","Active Tickets","Avg Age (Days)","Oldest Age (Days)","Tickets 7+ Days","Tickets 15+ Days"]}
          />

          {/* Developer Time Log — with status filter */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:4, marginBottom:2 }}>
            <span style={{ fontSize:10, color:C.dimmer, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:600, marginRight:4 }}>Log Status:</span>
            {STATUS_PILLS.map(s => (
              <button key={s} onClick={()=>setTimeLogFilter(s)} style={{ background:timeLogFilter===s?C.blue:"transparent", border:`1px solid ${timeLogFilter===s?C.blue:C.border}`, color:timeLogFilter===s?C.white:C.dim, borderRadius:20, padding:"4px 12px", fontSize:10, fontWeight:600, cursor:"pointer", transition:"all .15s", letterSpacing:"0.04em" }}>
                {s}
              </button>
            ))}
          </div>
          <AnomalySection
            title={`Developer Time Log (${timeLogRows.length})`}
            rows={timeLogRows.map(r => {
              const isNoLog = r.logging_status === 'No Log This Week';
              const isLate  = r.logging_status === 'No Log in 3+ Days';
              const statusColor = isNoLog ? C.red : isLate ? C.amber : C.green;
              return [
                <span style={{ fontSize:12, color:C.white, fontWeight:600 }}>{r.name}</span>,
                <span style={{ fontSize:11, color:C.dim }}>{r.team}</span>,
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, color:C.green }}>{(r.hours_today||0).toFixed(1)}h</span>,
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, color:C.blueLight }}>{(r.hours_yesterday||0).toFixed(1)}h</span>,
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, color:C.blueLight }}>{(r.hours_last_7days||0).toFixed(1)}h</span>,
                <span style={{ fontSize:11, color:C.dim }}>{fmtDate(r.last_log_date)}</span>,
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, color:isNoLog||isLate?statusColor:C.dim }}>{r.days_since_last_log ?? '—'}</span>,
                <span style={{ fontSize:11, color:statusColor, fontWeight:600, background:statusColor+"18", border:`1px solid ${statusColor}44`, borderRadius:20, padding:"2px 10px", display:"inline-block" }}>{r.logging_status}</span>,
              ];
            })}
            columns={["Developer","Team","Today","Yesterday","Last 7 Days","Last Log Date","Days Since","Status"]}
          />
        </div>
      )}
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
  Intelligence: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 1 7 7v1a7 7 0 0 1-14 0V9a7 7 0 0 1 7-7z"/><path d="M8 21h8M12 17v4"/><circle cx="12" cy="9" r="1" fill="currentColor"/></svg>,
};
const NAV_ITEMS = ["Overview","Tickets","People","Time","Admin","Intelligence"];

function TelegramWebhookCard() {
  const [webhookInfo, setWebhookInfo] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [registering, setRegistering] = useState(false);
  const [customUrl, setCustomUrl]     = useState('');
  const [result, setResult]           = useState(null);

  const defaultUrl = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    fetch('/api/admin/telegram-setup')
      .then(r => r.json())
      .then(d => { setWebhookInfo(d?.result || null); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function registerWebhook() {
    setRegistering(true);
    setResult(null);
    const url = customUrl.trim() || defaultUrl;
    try {
      const res = await fetch('/api/admin/telegram-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      setResult(data);
      if (data.ok) {
        // Refresh webhook info
        const info = await fetch('/api/admin/telegram-setup').then(r => r.json());
        setWebhookInfo(info?.result || null);
      }
    } catch (e) {
      setResult({ ok: false, description: e.message });
    }
    setRegistering(false);
  }

  const isRegistered = webhookInfo?.url && webhookInfo.url.length > 0;
  const pendingCount = webhookInfo?.pending_update_count || 0;

  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <Label size={13}>Telegram Bot Webhook</Label>
        {!loading && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: isRegistered ? 'rgba(26,158,110,0.15)' : 'rgba(224,62,62,0.15)',
            color: isRegistered ? C.green : C.red,
          }}>
            {isRegistered ? 'REGISTERED' : 'NOT SET'}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ color: C.dim, fontSize: 13 }}>Checking webhook status...</div>
      ) : (
        <>
          {isRegistered && (
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 16, fontSize: 12 }}>
              <div style={{ color: C.dim, marginBottom: 6 }}>Current webhook URL</div>
              <div style={{ color: C.blueLight, wordBreak: 'break-all' }}>{webhookInfo.url}</div>
              {pendingCount > 0 && (
                <div style={{ marginTop: 8, color: C.amber }}>⚠ {pendingCount} pending update{pendingCount !== 1 ? 's' : ''} in queue</div>
              )}
              {webhookInfo.last_error_message && (
                <div style={{ marginTop: 8, color: C.red }}>Last error: {webhookInfo.last_error_message}</div>
              )}
            </div>
          )}

          <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>
            Domain to register <span style={{ color: C.dimmer }}>(leave blank to use current: <b style={{ color: C.white }}>{defaultUrl}</b>)</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="text"
              placeholder={`${defaultUrl} (default)`}
              value={customUrl}
              onChange={e => setCustomUrl(e.target.value)}
              style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: C.bg, border: `1px solid ${C.border}`, color: C.white, fontSize: 13 }}
            />
            <button
              onClick={registerWebhook}
              disabled={registering}
              style={{ background: C.blue, color: C.white, border: 'none', borderRadius: 8, padding: '0 20px', fontWeight: 700, cursor: registering ? 'not-allowed' : 'pointer', opacity: registering ? 0.6 : 1, whiteSpace: 'nowrap' }}
            >
              {registering ? 'Registering...' : isRegistered ? 'Re-register' : 'Register Webhook'}
            </button>
          </div>

          {result && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 12,
              background: result.ok ? 'rgba(26,158,110,0.12)' : 'rgba(224,62,62,0.12)',
              color: result.ok ? C.green : C.red,
              border: `1px solid ${result.ok ? 'rgba(26,158,110,0.3)' : 'rgba(224,62,62,0.3)'}`,
            }}>
              {result.ok
                ? `✓ Webhook registered → ${result.webhookUrl}`
                : `✗ ${result.description || result.error}`}
            </div>
          )}

          <div style={{ marginTop: 14, fontSize: 11, color: C.dimmer }}>
            This is a <b>one-time setup</b>. Only re-register if the domain changes. Adding new bot users only requires updating their Telegram ID in Dashboard Users above.
          </div>
        </>
      )}
    </Card>
  );
}

const CONCERN_OPTIONS = [
  { id: 'overdue_tickets',   label: 'Overdue Tickets' },
  { id: 'missing_time_logs', label: 'Missing Time Logs' },
  { id: 'blocked_tickets',   label: 'Blocked Tickets' },
  { id: 'project_risks',     label: 'Project Risks' },
  { id: 'team_health',       label: 'Team Health' },
  { id: 'capacity',          label: 'Capacity / Workload' },
];

function UserDemandsCard() {
  const [queries, setQueries] = useState([]);
  const [loading, setLoading] = useState(true);

  const STATUS_COLORS = { unreviewed: C.dimmer, planned: C.amber, building: C.blueLight, done: C.green };
  const FREQ_COLOR = f => f >= 5 ? C.red : f >= 3 ? C.amber : C.dim;

  useEffect(() => {
    fetch('/api/admin/unknown-queries').then(r => r.json()).then(d => {
      setQueries(d.queries || []);
      setLoading(false);
    });
  }, []);

  async function updateStatus(id, status) {
    setQueries(q => q.map(x => x.id === id ? { ...x, status } : x));
    await fetch('/api/admin/unknown-queries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
  }

  if (loading) return null;

  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <Label size={13}>User Demands — Bot Unknown Queries</Label>
        <span style={{ fontSize: 11, color: C.dimmer }}>{queries.length} total</span>
      </div>
      {queries.length === 0 ? (
        <div style={{ fontSize: 12, color: C.dimmer, textAlign: 'center', padding: '20px 0' }}>No unknown queries yet — the bot logs here when it can't answer something.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {queries.map(q => (
            <div key={q.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: C.white, marginBottom: 4, lineHeight: 1.4 }}>{q.query_text}</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {q.asked_by && <span style={{ fontSize: 11, color: C.dimmer }}>{q.asked_by}</span>}
                  {q.user_role && <span style={{ fontSize: 10, color: C.dim, background: C.card, borderRadius: 4, padding: '1px 7px', textTransform: 'capitalize' }}>{q.user_role}</span>}
                  {q.user_team && <span style={{ fontSize: 10, color: C.dim, background: C.card, borderRadius: 4, padding: '1px 7px' }}>{q.user_team}</span>}
                  <span style={{ fontSize: 11, color: FREQ_COLOR(q.frequency), fontWeight: 700 }}>{q.frequency}×</span>
                  {q.suggested_alternative && (
                    <span style={{ fontSize: 11, color: C.amber, fontStyle: 'italic' }}>Suggested: {q.suggested_alternative}</span>
                  )}
                </div>
              </div>
              <select
                value={q.status}
                onChange={e => updateStatus(q.id, e.target.value)}
                style={{ background: C.card, border: `1px solid ${STATUS_COLORS[q.status]}44`, color: STATUS_COLORS[q.status], borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', outline: 'none', flexShrink: 0 }}>
                {['unreviewed', 'planned', 'building', 'done'].map(s => (
                  <option key={s} value={s} style={{ color: C.white, background: C.card }}>{s}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DashboardUsersCard() {
  const [users, setUsers]           = useState([]);
  const [redmineUsers, setRedmineUsers] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [editingId, setEditingId]   = useState(null);
  const [form, setForm]             = useState({});
  const [saving, setSaving]         = useState(false);
  const [manualEmail, setManualEmail] = useState(false);
  const [search, setSearch]         = useState('');

  const ROLES = ['manager', 'team_lead'];
  const inp = { width: '100%', padding: '7px 10px', borderRadius: 6, background: C.bg, border: `1px solid ${C.border}`, color: C.white, fontSize: 12, outline: 'none', boxSizing: 'border-box' };
  const lbl = { fontSize: 11, color: C.dimmer, marginBottom: 3 };

  useEffect(() => { load(); }, []);

  async function load() {
    const [du, ru] = await Promise.all([
      fetch('/api/admin/dashboard-users').then(r => r.json()),
      fetch('/api/admin/users').then(r => r.json()),
    ]);
    setUsers(du.users || []);
    setRedmineUsers(ru.users || []);
    setLoading(false);
  }

  function startEdit(u) {
    setEditingId(u.id);
    const bp = typeof u.behavior_profile === 'string'
      ? (() => { try { return JSON.parse(u.behavior_profile); } catch { return {}; } })()
      : (u.behavior_profile || {});
    setForm({
      display_name: u.display_name, role: u.role, team: u.team || '',
      telegram_id: u.telegram_id || '', active: u.active,
      response_style: u.response_style || bp.response_style || 'adaptive',
      morning_briefing: u.morning_briefing || bp.morning_briefing || 'none',
      top_concerns: u.top_concerns || [],
    });
    setManualEmail(false);
    setSearch('');
  }

  function startNew() {
    setEditingId('new');
    setForm({ username: '', password: '', display_name: '', role: 'team_lead', team: '', telegram_id: '', linked_redmine_user_id: null });
    setManualEmail(false);
    setSearch('');
  }

  function selectRedmineUser(ru) {
    setForm(f => ({
      ...f,
      display_name: ru.name,
      team: ru.team || f.team,
      linked_redmine_user_id: ru.id,
      username: f.username || ru.name.split(' ')[0].toLowerCase(),
    }));
    setSearch(ru.name + (ru.email ? ` — ${ru.email}` : ''));
  }

  // Filtered redmine users for dropdown
  const filteredRU = search.length > 1
    ? redmineUsers.filter(u =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(search.toLowerCase())
      ).slice(0, 8)
    : [];

  async function save() {
    setSaving(true);
    if (editingId === 'new') {
      if (!form.username?.trim() || !form.password?.trim() || !form.display_name?.trim())
        { alert('Username, password and display name are required'); setSaving(false); return; }
      const res = await fetch('/api/admin/dashboard-users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, telegram_id: form.telegram_id ? Number(form.telegram_id) : null, linked_redmine_user_id: form.linked_redmine_user_id || null }),
      });
      const d = await res.json();
      if (!res.ok) { alert(d.error || 'Save failed'); setSaving(false); return; }
    } else {
      await fetch('/api/admin/dashboard-users', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...form, telegram_id: form.telegram_id ? Number(form.telegram_id) : null }),
      });
    }
    setEditingId(null); setForm({});
    await load();
    setSaving(false);
  }

  async function toggleActive(u) {
    await fetch('/api/admin/dashboard-users', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, active: !u.active }),
    });
    setUsers(users.map(x => x.id === u.id ? { ...x, active: !x.active } : x));
  }

  const roleColor = r => r === 'manager' ? C.blue : C.amber;

  if (loading) return null;

  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Label size={13}>Dashboard Users & Bot Access</Label>
        <button onClick={startNew} style={{ background: C.blue, color: C.white, border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>+ Add User</button>
      </div>

      {/* User list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: editingId ? 16 : 0 }}>
        {users.map(u => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: C.bg, border: `1px solid ${u.active ? C.border : C.border + '60'}`, borderRadius: 8, opacity: u.active ? 1 : 0.5 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: roleColor(u.role) + '22', border: `1px solid ${roleColor(u.role)}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: roleColor(u.role), flexShrink: 0 }}>
              {(u.display_name || u.username).slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.white }}>{u.display_name}</span>
                <span style={{ fontSize: 10, color: C.dimmer }}>@{u.username}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: roleColor(u.role), background: roleColor(u.role) + '18', border: `1px solid ${roleColor(u.role)}40`, borderRadius: 4, padding: '1px 7px', textTransform: 'uppercase' }}>{u.role}</span>
                {u.team && <span style={{ fontSize: 10, color: C.dim, background: C.card, borderRadius: 4, padding: '1px 7px' }}>{u.team}</span>}
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.dimmer }}>
                {u.telegram_id
                  ? <span style={{ color: '#29b6f6' }}>✈ {u.telegram_id}</span>
                  : <span style={{ fontStyle: 'italic' }}>no Telegram</span>}
                {u.email && <span style={{ color: C.dimmer }}>· {u.email}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => startEdit(u)} style={{ background: 'none', border: `1px solid ${C.borderHi}`, color: C.dim, borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>Edit</button>
              <button onClick={() => toggleActive(u)} style={{ background: 'none', border: `1px solid ${C.borderHi}`, color: u.active ? '#ef4444' : '#22c55e', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                {u.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit form */}
      {editingId && (
        <div style={{ background: C.bg, border: `1px solid ${C.borderHi}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.white, marginBottom: 14 }}>
            {editingId === 'new' ? 'New Dashboard User' : `Edit — ${users.find(u => u.id === editingId)?.display_name}`}
          </div>

          {/* Redmine user picker — only for new users */}
          {editingId === 'new' && (
            <div style={{ marginBottom: 14 }}>
              <div style={lbl}>Select from Redmine users <span style={{ color: C.dimmer, fontWeight: 400 }}>(auto-fills name & team)</span></div>
              <div style={{ position: 'relative' }}>
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); setManualEmail(false); }}
                  placeholder="Type name or email to search… or leave blank to enter manually"
                  style={{ ...inp, paddingRight: 90 }}
                />
                {search && (
                  <button onClick={() => { setSearch(''); setForm(f => ({ ...f, display_name: '', email: '', team: '' })); }}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.dimmer, cursor: 'pointer', fontSize: 11 }}>
                    Clear
                  </button>
                )}
                {filteredRU.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: C.card, border: `1px solid ${C.borderHi}`, borderRadius: 6, zIndex: 50, maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                    {filteredRU.map(ru => (
                      <div key={ru.id} onClick={() => selectRedmineUser(ru)}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        onMouseEnter={e => e.currentTarget.style.background = C.bg}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <span style={{ color: C.white }}>{ru.name}</span>
                        <span style={{ color: C.dimmer, fontSize: 11 }}>{ru.email || 'no email'} {ru.team ? `· ${ru.team}` : ''}</span>
                      </div>
                    ))}
                    <div onClick={() => { setManualEmail(true); setSearch(''); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: C.blueLight }}
                      onMouseEnter={e => e.currentTarget.style.background = C.bg}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      + Not in list — add email manually
                    </div>
                  </div>
                )}
              </div>
              {manualEmail && (
                <div style={{ marginTop: 8 }}>
                  <div style={lbl}>Email <span style={{ color: C.dimmer, fontWeight: 400 }}>(not in Redmine)</span></div>
                  <input value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@company.com" style={inp} />
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {editingId === 'new' && <>
              <div>
                <div style={lbl}>Username</div>
                <input value={form.username || ''} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="deepak" style={inp} />
              </div>
              <div>
                <div style={lbl}>Password</div>
                <input type="password" value={form.password || ''} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" style={inp} />
              </div>
            </>}
            <div>
              <div style={lbl}>Display Name</div>
              <input value={form.display_name || ''} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="Deepak Sharma" style={inp} />
            </div>
            <div>
              <div style={lbl}>Role</div>
              <select value={form.role || 'team_lead'} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={{ ...inp, cursor: 'pointer' }}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <div style={lbl}>Team</div>
              <input value={form.team || ''} onChange={e => setForm(f => ({ ...f, team: e.target.value }))} placeholder="QA / Java / DB …" style={inp} />
            </div>
            <div>
              <div style={lbl}>Telegram ID <span style={{ color: C.dimmer, fontWeight: 400 }}>(numeric)</span></div>
              <input value={form.telegram_id || ''} onChange={e => setForm(f => ({ ...f, telegram_id: e.target.value }))} placeholder="e.g. 8600897389" style={inp} />
            </div>
          </div>

          <div style={{ fontSize: 11, color: C.dimmer, marginTop: 10 }}>
            Telegram ID: ask user to message <span style={{ color: C.blueLight }}>@userinfobot</span> — or they'll see it when they first message the bot.
          </div>

          {/* Personalization — only for existing users */}
          {editingId !== 'new' && (
            <div style={{ marginTop: 16, padding: '14px 16px', background: C.card, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.blueLight, marginBottom: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Bot Personalization</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={lbl}>Response Style</div>
                  <select value={form.response_style || 'adaptive'} onChange={e => setForm(f => ({ ...f, response_style: e.target.value }))}
                    style={{ ...inp, cursor: 'pointer' }}>
                    <option value="adaptive">Adaptive (default)</option>
                    <option value="brief">Brief (bullets only)</option>
                    <option value="detailed">Detailed (full context)</option>
                  </select>
                </div>
                <div>
                  <div style={lbl}>Morning Briefing</div>
                  <select value={form.morning_briefing || 'none'} onChange={e => setForm(f => ({ ...f, morning_briefing: e.target.value }))}
                    style={{ ...inp, cursor: 'pointer' }}>
                    <option value="none">Off</option>
                    <option value="weekdays">Weekdays (Mon–Fri)</option>
                    <option value="daily">Daily</option>
                  </select>
                </div>
              </div>
              <div>
                <div style={lbl}>Top Concerns <span style={{ color: C.dimmer, fontWeight: 400 }}>(bot will proactively surface these)</span></div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {CONCERN_OPTIONS.map(c => {
                    const active = (form.top_concerns || []).includes(c.id);
                    return (
                      <button key={c.id} onClick={() => setForm(f => ({
                        ...f,
                        top_concerns: active
                          ? (f.top_concerns || []).filter(x => x !== c.id)
                          : [...(f.top_concerns || []), c.id],
                      }))}
                        style={{ background: active ? C.blue + '22' : 'transparent', border: `1px solid ${active ? C.blue : C.borderHi}`, color: active ? C.blueLight : C.dim, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: active ? 600 : 400, cursor: 'pointer', transition: 'all .15s' }}>
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button onClick={() => { setEditingId(null); setForm({}); setSearch(''); setManualEmail(false); }} style={{ background: 'none', border: `1px solid ${C.borderHi}`, color: C.dim, borderRadius: 6, padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ background: C.blue, color: C.white, border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : editingId === 'new' ? 'Create User' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function AIConfigCard() {
  const [configs, setConfigs]     = useState([]);
  const [effective, setEffective] = useState(null);
  const [editingId, setEditingId] = useState(null); // null | 'new' | number
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);

  const PROVIDERS    = ['openrouter', 'anthropic', 'openai'];
  const PROVIDER_URL = { openrouter: 'https://openrouter.ai/api/v1', anthropic: 'https://api.anthropic.com/v1', openai: 'https://api.openai.com/v1' };
  const PCOLOR       = { openrouter: '#8b5cf6', anthropic: '#f97316', openai: '#10b981' };
  const pColor       = p => PCOLOR[p] || C.blueLight;

  useEffect(() => { load(); }, []);

  async function load() {
    const res = await fetch('/api/admin/ai-config');
    const d   = await res.json();
    setConfigs(d.configs   || []);
    setEffective(d.effective || null);
  }

  const active  = configs.find(c => c.is_active);
  const history = configs.filter(c => !c.is_active);

  function startEdit(cfg) {
    setEditingId(cfg.id);
    setForm({ provider: cfg.provider, api_key: '', base_url: cfg.base_url || '', default_model: cfg.default_model || '', embedding_model: cfg.embedding_model || '' });
  }

  function startNew() {
    setEditingId('new');
    setForm({ provider: 'openrouter', api_key: '', base_url: PROVIDER_URL.openrouter, default_model: '', embedding_model: 'openai/text-embedding-3-small' });
  }

  async function save() {
    if (!form.default_model.trim()) return alert('Model name is required');
    if (editingId === 'new' && !form.api_key.trim()) return alert('API key is required');
    setSaving(true);
    const body = editingId === 'new' ? form : { id: editingId, ...form };
    const res  = await fetch('/api/admin/ai-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { alert('Save failed'); setSaving(false); return; }
    setEditingId(null);
    setForm({});
    await load();
    setSaving(false);
  }

  async function restore(id) {
    setSaving(true);
    await fetch('/api/admin/ai-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_active: true }) });
    await load();
    setSaving(false);
  }

  const disp = effective;
  const inp  = { width: '100%', padding: '8px 12px', borderRadius: 6, background: C.bg, border: `1px solid ${C.border}`, color: C.white, fontSize: 12, outline: 'none', boxSizing: 'border-box' };
  const lbl  = { fontSize: 11, color: C.dimmer, marginBottom: 4 };

  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Label size={13}>AI Configuration</Label>
        <button onClick={startNew} style={{ background: C.blue, color: C.white, border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>+ New Config</button>
      </div>

      {/* Active / effective config display */}
      {(!editingId || editingId === 'new') && disp && (
        <div style={{ background: C.bg, border: `1px solid ${pColor(disp.provider)}44`, borderRadius: 10, padding: 16, marginBottom: editingId === 'new' ? 16 : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ background: pColor(disp.provider) + '22', border: `1px solid ${pColor(disp.provider)}66`, borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: pColor(disp.provider), textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {disp.provider}
              </div>
              {disp.source === 'env' && (
                <div style={{ fontSize: 10, color: C.amber, background: C.amber + '18', border: `1px solid ${C.amber}44`, borderRadius: 4, padding: '2px 8px' }}>env fallback — not in DB</div>
              )}
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px #22c55e88' }} title="Active" />
            </div>
            {active && (
              <button onClick={() => startEdit(active)} style={{ background: 'none', border: `1px solid ${C.borderHi}`, color: C.dim, borderRadius: 6, padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}>Edit</button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 28px' }}>
            <div>
              <div style={lbl}>Model</div>
              <div style={{ fontSize: 12, color: C.white, fontFamily: 'monospace', wordBreak: 'break-all' }}>{disp.default_model || '—'}</div>
            </div>
            <div>
              <div style={lbl}>API Key</div>
              <div style={{ fontSize: 12, color: C.white, fontFamily: 'monospace' }}>{disp.api_key_preview || '••••••••'}</div>
            </div>
            <div>
              <div style={lbl}>Base URL</div>
              <div style={{ fontSize: 11, color: C.dim, wordBreak: 'break-all' }}>{disp.base_url || '—'}</div>
            </div>
            <div>
              <div style={lbl}>Embedding Model</div>
              <div style={{ fontSize: 11, color: C.dim, fontFamily: 'monospace' }}>{disp.embedding_model || '—'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Edit / New form */}
      {editingId && (
        <div style={{ background: C.bg, border: `1px solid ${C.borderHi}`, borderRadius: 10, padding: 16, marginTop: editingId === 'new' ? 0 : 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.white, marginBottom: 14 }}>
            {editingId === 'new' ? 'New Configuration' : 'Edit Active Configuration'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={lbl}>Provider</div>
              <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value, base_url: PROVIDER_URL[e.target.value] || f.base_url }))}
                style={{ ...inp, cursor: 'pointer' }}>
                {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <div style={lbl}>API Key {editingId !== 'new' && <span style={{ color: C.dimmer, fontWeight: 400 }}>(blank = keep current)</span>}</div>
              <input type="password" value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
                placeholder={editingId !== 'new' ? '(unchanged)' : 'sk-or-v1-...'} style={inp} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={lbl}>Model</div>
              <input value={form.default_model} onChange={e => setForm(f => ({ ...f, default_model: e.target.value }))}
                placeholder="e.g. nvidia/nemotron-3-super-120b-a12b:free" style={inp} />
            </div>
            <div>
              <div style={lbl}>Base URL</div>
              <input value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} style={inp} />
            </div>
            <div>
              <div style={lbl}>Embedding Model</div>
              <input value={form.embedding_model} onChange={e => setForm(f => ({ ...f, embedding_model: e.target.value }))}
                placeholder="openai/text-embedding-3-small" style={inp} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button onClick={() => { setEditingId(null); setForm({}); }}
              style={{ background: 'none', border: `1px solid ${C.borderHi}`, color: C.dim, borderRadius: 6, padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              style={{ background: C.blue, color: C.white, border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : editingId === 'new' ? 'Save & Activate' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Config history */}
      {history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, color: C.dimmer, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Previous Configs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.map(cfg => (
              <div key={cfg.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: pColor(cfg.provider), textTransform: 'uppercase' }}>{cfg.provider}</div>
                  <div style={{ fontSize: 11, color: C.dim, fontFamily: 'monospace' }}>{cfg.default_model}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 10, color: C.dimmer }}>{new Date(cfg.created_at).toLocaleDateString()}</div>
                  <button onClick={() => restore(cfg.id)} disabled={saving}
                    style={{ background: 'none', border: `1px solid ${C.borderHi}`, color: C.blueLight, borderRadius: 4, padding: '3px 10px', fontSize: 10, cursor: 'pointer' }}>
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Admin() {
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [sheetUrl, setSheetUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/users').then(r=>r.json()),
      fetch('/api/admin/projects').then(r=>r.json())
    ]).then(([u, p]) => {
      setUsers(u.users || []);
      setProjects(p.projects || []);
      setLoading(false);
    });
  }, []);

  const TEAMS = [...new Set(users.map(u => u.team).filter(Boolean))].sort();
  const unmapped = users.filter(u => !u.team);
  const managers = users.filter(u => u.role === 'Manager' || projects.some(p => p.manager_id === u.id));
  const nonManagers = users.filter(u => !managers.find(m => m.id === u.id));

  async function updateUser(id, updates) {
    if (!id) return;
    const u = users.find(x=>x.id===id);
    if (!u) return;
    const merged = typeof updates === 'object' ? updates : {};
    const body = { id, team: u.team, role: u.role, is_team_lead: u.is_team_lead, ...merged };
    setUsers(users.map(x => x.id===id ? { ...x, ...merged } : x));
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
      {/* User Demands — Bot Unknown Queries */}
      <UserDemandsCard />

      {/* AI Configuration Card */}
      <AIConfigCard />

      {/* Telegram Webhook Registration Card */}
      <TelegramWebhookCard />

      {/* Dashboard Users & Bot Access Card */}
      <DashboardUsersCard />

      {/* Google Sheets Sync Card */}
      <Card style={{ padding: 24 }}>
        <Label size={13}>Google Sheets Leave Sync</Label>
        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
          <input type="text" placeholder="https://docs.google.com/spreadsheets/.../export?format=csv" value={sheetUrl} onChange={e=>setSheetUrl(e.target.value)} style={{ flex: 1, padding: "10px 14px", borderRadius: 8, background: C.bg, border: `1px solid ${C.border}`, color: C.white }} />
          <button onClick={syncLeave} style={{ background: C.blue, color: C.white, border: "none", borderRadius: 8, padding: "0 20px", fontWeight: 600, cursor: "pointer" }}>Sync Leave</button>
        </div>
      </Card>

      {/* Teams Mapping Card */}
      <Card style={{ padding: 24 }}>
        <Label size={13}>Team Mapping & Leads</Label>
        <div style={{ marginTop: 10, fontSize: 12, color: C.dimmer }}>Unmapped employees: {unmapped.length}</div>
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, marginTop: 20 }}>
          {TEAMS.map(team => {
            const members = users.filter(u => u.team === team).sort((a,b)=> (b.is_team_lead?1:0) - (a.is_team_lead?1:0) || a.name.localeCompare(b.name));
            return (
              <div key={team} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.white }}>{team}</div>
                  <div style={{ fontSize: 11, color: C.dim }}>{members.length} members</div>
                </div>
                
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                  {members.map(m => (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", background: C.card, borderRadius: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {m.is_team_lead && <svg width="12" height="12" viewBox="0 0 24 24" fill={C.amber} stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
                        <span style={{ fontSize: 12, color: m.is_team_lead ? C.amber : C.dim }}>{m.name}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button onClick={() => updateUser(m.id, { is_team_lead: !m.is_team_lead })} style={{ background: "none", border: "none", color: C.blueLight, fontSize: 10, cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>{m.is_team_lead ? 'Revoke Lead' : 'Make Lead'}</button>
                        <button onClick={() => updateUser(m.id, { team: null, is_team_lead: false })} style={{ background: "none", border: "none", color: C.dimmer, fontSize: 14, cursor: "pointer", lineHeight: 1 }}>&times;</button>
                      </div>
                    </div>
                  ))}
                </div>

                <select value="" onChange={e => updateUser(parseInt(e.target.value), { team })} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, background: C.card, color: C.dim, border: `1px solid ${C.border}`, outline: "none", cursor: "pointer" }}>
                  <option value="" disabled>+ Add Member</option>
                  {unmapped.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Project Managers Card */}
      <Card style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Label size={13}>Project Managers</Label>
          <select value="" onChange={e => updateUser(parseInt(e.target.value), { role: 'Manager' })} style={{ padding: "8px 16px", borderRadius: 8, background: C.blue, color: C.white, border: "none", outline: "none", cursor: "pointer", fontWeight: 600 }}>
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
                  <button onClick={() => { updateUser(mgr.id, { role: 'Member' }); mProps.forEach(p => updateProject(p.id, null)); }} style={{ background: "none", border: `1px solid ${C.borderHi}`, color: C.dimmer, borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}>Remove Manager</button>
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

                <select value="" onChange={e => updateProject(parseInt(e.target.value), mgr.id)} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, background: C.card, color: C.dim, border: `1px solid ${C.border}`, outline: "none", cursor: "pointer" }}>
                  <option value="" disabled>+ Assign Project</option>
                  {availProps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── ROOT EXPORT ───────────────────────────────────────────────────
export default function Dashboard({ onLogout, currentUser }) {
  const [screen, setScreen] = useState("Overview");
  const [data, setData]     = useState({ overview: {}, people: [], tickets: [], timeLogs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [oneOnOnePerson, setOneOnOnePerson] = useState(null);
  const fetchingRef = React.useRef(false);

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
      if (res.ok) {
        // Delta sync runs in background (~10-30s). Refresh data after 30s.
        setTimeout(async () => {
          await fetchAll();
          setSyncing(false);
        }, 30000);
      } else {
        alert("Sync failed. Check terminal logs.");
        setSyncing(false);
      }
    } catch (err) {
      alert("Network error during sync.");
      setSyncing(false);
    }
  }

  const { overview, people, tickets, timeLogs } = data;

  const [person, setPerson] = useState(null);
  const [ticket, setTicket] = useState(null);

  return (
    <div style={{ fontFamily:"'Barlow',sans-serif", background:C.bg, minHeight:"100vh", color:C.white, display:"flex" }}>
      {/* ── SIDEBAR ── */}
      <div style={{ width:C.sidebarW, flexShrink:0, background:C.surface, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", height:"100vh", position:"sticky", top:0 }}>
        <div style={{ padding:"28px 24px 24px" }}>
          <div style={{ fontSize:9, color:C.dimmer, letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:4 }}>Command Centre</div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:20, fontWeight:700, color:C.white, letterSpacing:"-0.01em", lineHeight:1.1 }}>RedMine<br/>Dashboard</div>
        </div>
        <Divider/>
        <nav style={{ padding:"16px 12px", display:"flex", flexDirection:"column", gap:4, flex:1 }}>
          {NAV_ITEMS.map(item=>{
            const active = screen===item;
            return (
              <button key={item} onClick={()=>setScreen(item)} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:10, border:"none", cursor:"pointer", background:active?"rgba(26,110,245,0.15)":"transparent", color:active?C.blue:C.dim, fontSize:13, fontWeight:600, letterSpacing:"0.01em", transition:"all .15s", textAlign:"left", width:"100%" }}
                onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="rgba(255,255,255,0.04)"; }}
                onMouseLeave={e=>{ if(!active) e.currentTarget.style.background="transparent"; }}>
                {NAV_ICONS[item]}{item}
                {active && <div style={{ marginLeft:"auto", width:4, height:4, borderRadius:"50%", background:C.blue }}/>}
              </button>
            );
          })}
        </nav>

        {/* ── USER INFO + LOGOUT ── */}
        <div style={{ padding:"16px 12px", borderTop:`1px solid ${C.border}` }}>
          {currentUser && (
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"0 4px", marginBottom:10 }}>
              <div style={{ width:30, height:30, borderRadius:"50%", background:C.card, border:`1px solid ${C.borderHi}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:C.blueLight, fontFamily:"'Barlow Condensed',sans-serif", flexShrink:0 }}>
                {(currentUser.display_name || currentUser.username || "U").split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase()}
              </div>
              <div style={{ flex:1, overflow:"hidden" }}>
                <div style={{ fontSize:12, fontWeight:600, color:C.white, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{currentUser.display_name || currentUser.username}</div>
                <div style={{ fontSize:10, color:C.dimmer, marginTop:1, textTransform:"capitalize" }}>{currentUser.role?.replace("_"," ")}{currentUser.team ? ` · ${currentUser.team}` : ""}</div>
              </div>
            </div>
          )}
          <div style={{ fontSize:11, color:C.dimmer, marginBottom:8, paddingLeft:4 }}>{new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</div>
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
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ padding:"20px 32px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:24, fontWeight:700, color:C.white, letterSpacing:"-0.01em" }}>{screen}</div>
            <div style={{ fontSize:11, color:C.dimmer, marginTop:2 }}>
              {screen==="Overview" && "Company pulse — today"}
              {screen==="Team"     && "Leave status by team"}
              {screen==="Time"     && "Time logging snapshot"}
              {screen==="Tickets"  && "Open issues tracker"}
              {screen==="People"   && "Team performance"}
              {screen==="Admin"    && "System configuration & data mapping"}
              {screen==="Intelligence" && "AI-powered insights & chat"}
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
              <Avatar initials={currentUser ? (currentUser.display_name || currentUser.username || "U").split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase() : "CE"} size={36}/>
            </div>
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"28px 32px", position:"relative" }}>
          {loading && (
            <div style={{ position:"absolute", inset:0, background:C.bg+"99", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
                <div style={{ width:40, height:40, border:`3px solid ${C.blue}22`, borderTopColor:C.blue, borderRadius:"50%", animation:"spin 1s linear infinite" }}/>
                <div style={{ fontSize:13, color:C.blue, fontWeight:600 }}>Hydrating Dashboard...</div>
              </div>
            </div>
          )}
          {error && <div style={{ color:C.red, padding:20, background:C.red+"11", borderRadius:12, border:`1px solid ${C.red}33` }}>{error}</div>}
          
          {screen==="Overview" && <Overview overview={overview} people={people} tickets={tickets} timeLogs={timeLogs} currentUser={currentUser}/>}
          {screen==="Time"     && <TimeLogs timeLogs={timeLogs}/>}
          {screen==="Tickets"  && <Tickets tickets={tickets} onSelectTicket={setTicket}/>}
          {screen==="People"   && <People people={people} overview={overview} onSelectPerson={setPerson} onPrepOneOnOne={setOneOnOnePerson}/>}
          {screen==="Admin"    && <Admin />}
          {screen==="Intelligence" && <IntelligenceChat currentUser={currentUser}/>}
        </div>

      </div>

      <PersonModal person={person} onClose={()=>setPerson(null)}/>
      <TicketModal ticket={ticket} onClose={()=>setTicket(null)}/>
      <OneOnOnePrep person={oneOnOnePerson} onClose={()=>setOneOnOnePerson(null)}/>
    </div>
  );
}
