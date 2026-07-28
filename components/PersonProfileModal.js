import { useState, useEffect, useRef } from 'react'

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
  cyan:     "#22D3EE",
  purple:   "#A855F7",
}

function Avatar({ initials, size = 40 }) {
  const hue = initials ? initials.charCodeAt(0) * 7 + (initials.charCodeAt(1) || 0) * 3 : 200
  const bg = `hsl(${hue % 360}, 50%, 22%)`
  const border = `hsl(${hue % 360}, 50%, 35%)`
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, border: `2px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed',sans-serif", fontSize: size * 0.38, fontWeight: 700, color: C.blueLight, flexShrink: 0 }}>
      {initials}
    </div>
  )
}

function Bar({ pct, color, h = 6 }) {
  return (
    <div style={{ flex: 1, height: h, background: 'rgba(255,255,255,0.08)', borderRadius: h / 2, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, height: '100%', background: color, borderRadius: h / 2, transition: 'width .3s ease' }} />
    </div>
  )
}

function Label({ children }) {
  return <div style={{ fontSize: 10, color: C.dimmer, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>{children}</div>
}

function ScoreRing({ score, size = 80 }) {
  const color = score >= 70 ? C.green : score >= 40 ? C.amber : C.red
  const pct = Math.min(Math.max(score || 0, 0), 100)
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: 'stroke-dashoffset .4s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{score ?? '—'}</div>
        <div style={{ fontSize: 8, color: C.dimmer, marginTop: 2 }}>SCORE</div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, color = C.white }) {
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 12px', textAlign: 'center' }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: C.dimmer, marginTop: 5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  )
}

function DimensionBar({ label, score, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: C.dim, width: 80, flexShrink: 0 }}>{label}</span>
      <Bar pct={score} color={color} h={5} />
      <span style={{ fontSize: 11, color: C.dimmer, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, width: 28, textAlign: 'right' }}>{score ?? 0}</span>
    </div>
  )
}

function VelocityChart({ breakdown }) {
  if (!breakdown || breakdown.length === 0) return <div style={{ fontSize: 11, color: C.dimmer }}>No velocity data</div>
  const max = Math.max(...breakdown.map(w => w.closed), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 48 }}>
      {breakdown.slice(-8).map((w, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{ width: '100%', height: Math.max((w.closed / max) * 40, 2), background: C.blue, borderRadius: 3, opacity: 0.8 }} />
          <span style={{ fontSize: 8, color: C.dimmer }}>{w.closed}</span>
        </div>
      ))}
    </div>
  )
}

const TABS = ['All', 'Performance', 'Workload', 'Activity']
const PERIODS = ['daily', 'weekly', 'monthly']

export default function PersonProfileModal({ person, profile, loading, onClose }) {
  const [activeTab, setActiveTab] = useState('All')
  const [period, setPeriod] = useState('daily')
  const [data, setData] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!person) return
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setFetching(true)
    setError(null)
    setData(null)
    setActiveTab('All')

    fetch(`/api/people/${person.id}/profile?period=${period}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() })
      .then(d => { setData(d); setFetching(false) })
      .catch(e => { if (e.name !== 'AbortError') { setError(e.message); setFetching(false) } })

    return () => controller.abort()
  }, [person?.id, period])

  if (!person) return null

  const p = data?.performance
  const v = data?.velocity
  const w = data?.workload
  const tl = data?.time_logging
  const cm = data?.commitments
  const tc = data?.team_context

  const showTab = (tab) => activeTab === 'All' || activeTab === tab

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(3,11,21,0.85)', backdropFilter: 'blur(6px)' }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: C.surface, border: `1px solid ${C.borderHi}`, borderRadius: 20, width: 680, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', animation: 'fadeIn .3s ease' }}>
        {/* Close button */}
        <button onClick={onClose} style={{ position: 'absolute', top: 20, right: 20, background: 'none', border: 'none', color: C.dimmer, fontSize: 20, cursor: 'pointer', zIndex: 10 }}>&#x2715;</button>

        {/* Header */}
        <div style={{ padding: '32px 36px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <Avatar initials={data?.person?.initials || person.initials} size={52} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.white, fontFamily: "'Barlow Condensed',sans-serif" }}>{data?.person?.name || person.name}</div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{data?.person?.role || person.role} · {data?.person?.team || person.team}</div>
            </div>
            {(data?.person?.leave || person.leave) && (
              <div style={{ background: C.amber + '18', border: `1px solid ${C.amber}44`, borderRadius: 8, padding: '5px 12px' }}>
                <span style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>{data?.person?.leave || person.leave} Leave</span>
              </div>
            )}
          </div>

          {/* Period selector */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{ background: period === p ? C.blue : 'transparent', border: `1px solid ${period === p ? C.blue : C.border}`, color: period === p ? C.white : C.dim, borderRadius: 20, padding: '4px 12px', fontSize: 10, fontWeight: 600, cursor: 'pointer', transition: 'all .15s', textTransform: 'capitalize' }}>
                {p}
              </button>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 6, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
            {TABS.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ background: 'none', border: 'none', borderBottom: activeTab === tab ? `2px solid ${C.blue}` : '2px solid transparent', color: activeTab === tab ? C.white : C.dim, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s', marginBottom: -1 }}>
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '24px 36px 32px' }}>
          {fetching && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 36, height: 36, border: `3px solid ${C.blue}22`, borderTopColor: C.blue, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <div style={{ fontSize: 12, color: C.blue, fontWeight: 600 }}>Loading profile...</div>
              </div>
            </div>
          )}

          {error && (
            <div style={{ background: C.red + '11', border: `1px solid ${C.red}33`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ color: C.red, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Failed to load profile</div>
              <button onClick={() => setPeriod(p)} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.white, borderRadius: 8, padding: '6px 16px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Retry</button>
            </div>
          )}

          {!fetching && !error && data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
              {/* ── Performance ── */}
              {showTab('Performance') && (
                <div>
                  {showTab('Performance') && activeTab !== 'All' && <Label>Performance</Label>}
                  {showTab('Performance') && activeTab !== 'All' && <div style={{ height: 12 }} />}
                  <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                    <ScoreRing score={p?.overall_score} size={90} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: C.dim }}>Trend:</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: p?.trend === 'rising' ? C.green : p?.trend === 'declining' ? C.red : C.dim }}>
                          {p?.trend === 'rising' ? '↑' : p?.trend === 'declining' ? '↓' : '→'} {p?.trend || 'stable'}
                        </span>
                        {p?.score_delta != null && p.score_delta !== 0 && (
                          <span style={{ fontSize: 10, color: p.score_delta > 0 ? C.green : C.red, fontWeight: 600 }}>
                            ({p.score_delta > 0 ? '+' : ''}{Math.round(p.score_delta)})
                          </span>
                        )}
                      </div>
                      <DimensionBar label="Output" score={p?.output_score} color={C.blueLight} />
                      <DimensionBar label="Speed" score={p?.speed_score} color={C.cyan} />
                      <DimensionBar label="Quality" score={p?.quality_score} color={C.green} />
                      <DimensionBar label="Reliability" score={p?.reliability_score} color={C.amber} />
                      <DimensionBar label="Collaboration" score={p?.collaboration_score} color={C.purple} />
                    </div>
                  </div>

                  {/* Velocity */}
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Label>Velocity</Label>
                      <span style={{ fontSize: 10, color: C.dim }}>
                        {v?.tickets_per_week ?? 0} tickets/week — <span style={{ color: v?.trend === 'accelerating' ? C.green : v?.trend === 'decelerating' ? C.red : C.dim, fontWeight: 600 }}>{v?.trend || 'stable'}</span>
                      </span>
                    </div>
                    <VelocityChart breakdown={v?.weekly_breakdown} />
                  </div>
                </div>
              )}

              {showTab('Performance') && showTab('Workload') && activeTab === 'All' && <div style={{ height: 1, background: C.border }} />}

              {/* ── Key Metrics Grid ── */}
              {showTab('Performance') && (
                <div>
                  {activeTab !== 'All' && <><Label>Key Metrics</Label><div style={{ height: 12 }} /></>}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    <MetricCard label="Tickets Closed" value={p?.tickets_closed ?? 0} color={C.blueLight} />
                    <MetricCard label="Avg Resolution" value={p?.avg_resolution_time_hrs != null ? `${Math.round(p.avg_resolution_time_hrs)}h` : '—'} color={C.cyan} />
                    <MetricCard label="Reopen Rate" value={p?.reopen_rate != null ? `${Math.round(p.reopen_rate * 100)}%` : '—'} color={p?.reopen_rate > 0.1 ? C.red : C.green} />
                    <MetricCard label="Deadline Hit" value={p?.deadline_hit_rate != null ? `${Math.round(p.deadline_hit_rate * 100)}%` : '—'} color={p?.deadline_hit_rate > 0.8 ? C.green : C.amber} />
                    <MetricCard label="Blockers Helped" value={p?.blockers_helped ?? 0} color={C.purple} />
                    <MetricCard label="Commitments" value={cm?.total > 0 ? `${cm.kept}/${cm.total}` : '—'} color={cm?.kept_rate != null && cm.kept_rate >= 80 ? C.green : C.amber} />
                  </div>
                </div>
              )}

              {showTab('Performance') && showTab('Workload') && activeTab === 'All' && <div style={{ height: 1, background: C.border }} />}

              {/* ── Workload ── */}
              {showTab('Workload') && (
                <div>
                  {activeTab !== 'All' && <><Label>Current Workload</Label><div style={{ height: 12 }} /></>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: C.dim }}>Workload</span>
                    <span style={{ fontSize: 11, color: w?.workload_pct > 80 ? C.red : w?.workload_pct > 50 ? C.amber : C.green, fontWeight: 600 }}>
                      {w?.workload_pct != null ? `${Math.round(w.workload_pct)}%` : '—'}
                    </span>
                  </div>
                  <Bar pct={w?.workload_pct || 0} color={w?.workload_pct > 80 ? C.red : w?.workload_pct > 50 ? C.amber : C.blue} h={6} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, marginBottom: 16 }}>
                    <span style={{ fontSize: 10, color: C.dimmer }}>{w?.active_tickets ?? 0} active tickets</span>
                    {w?.predicted_free_date && <span style={{ fontSize: 10, color: C.dimmer }}>Free: {w.predicted_free_date}</span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    <MetricCard label="Overdue" value={w?.overdue ?? 0} color={w?.overdue > 0 ? C.red : C.green} />
                    <MetricCard label="Due Soon" value={w?.due_soon ?? 0} color={C.amber} />
                    <MetricCard label="High Pri" value={w?.high_priority ?? 0} color={C.red} />
                    <MetricCard label="Avg Age" value={w?.avg_age_days != null ? `${w.avg_age_days}d` : '—'} color={C.dim} />
                  </div>
                </div>
              )}

              {showTab('Workload') && showTab('Activity') && activeTab === 'All' && <div style={{ height: 1, background: C.border }} />}

              {/* ── Activity ── */}
              {showTab('Activity') && (
                <div>
                  {activeTab !== 'All' && <><Label>Time Logging</Label><div style={{ height: 12 }} /></>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: C.dim }}>Hours This Month</span>
                    <span style={{ fontSize: 11, color: C.dim }}>{tl?.hours_this_month ?? 0}h / 160h</span>
                  </div>
                  <Bar pct={((tl?.hours_this_month || 0) / 160) * 100} color={C.blue} h={6} />
                  <div style={{ display: 'flex', gap: 20, marginTop: 12, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: C.dimmer, marginBottom: 2 }}>Days Logged</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: C.white, fontFamily: "'Barlow Condensed',sans-serif" }}>
                        {tl?.days_logged_this_month ?? 0} <span style={{ fontSize: 11, color: C.dimmer, fontWeight: 400 }}>/ {tl?.total_working_days_month ?? 0}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: C.dimmer, marginBottom: 2 }}>Last 7 Days</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: C.white, fontFamily: "'Barlow Condensed',sans-serif" }}>{tl?.hours_last_7days ?? 0}h</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: C.dimmer, marginBottom: 2 }}>Status</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: tl?.logging_status === 'Logged Recently' ? C.green : C.amber, padding: '3px 8px', background: (tl?.logging_status === 'Logged Recently' ? C.green : C.amber) + '18', borderRadius: 6, display: 'inline-block' }}>
                        {tl?.logging_status || '—'}
                      </div>
                    </div>
                  </div>

                  {/* Commitments */}
                  {cm && cm.total > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <Label>Commitment Track Record</Label>
                      <div style={{ height: 10 }} />
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div style={{ background: C.green + '18', border: `1px solid ${C.green}44`, borderRadius: 8, padding: '8px 14px', textAlign: 'center' }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: C.green, fontFamily: "'Barlow Condensed',sans-serif" }}>{cm.kept}</div>
                          <div style={{ fontSize: 9, color: C.green, marginTop: 2 }}>KEPT</div>
                        </div>
                        <div style={{ background: C.red + '18', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '8px 14px', textAlign: 'center' }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: C.red, fontFamily: "'Barlow Condensed',sans-serif" }}>{cm.missed}</div>
                          <div style={{ fontSize: 9, color: C.red, marginTop: 2 }}>MISSED</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: C.dimmer, marginBottom: 4 }}>Keep Rate</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Bar pct={cm.kept_rate || 0} color={cm.kept_rate >= 80 ? C.green : cm.kept_rate >= 50 ? C.amber : C.red} h={5} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: cm.kept_rate >= 80 ? C.green : cm.kept_rate >= 50 ? C.amber : C.red, fontFamily: "'Barlow Condensed',sans-serif" }}>{cm.kept_rate}%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Team Comparison ── */}
              {showTab('Performance') && tc?.individual_vs_team && (
                <div>
                  <div style={{ height: 1, background: C.border, marginBottom: 20 }} />
                  <Label>Team Comparison</Label>
                  <div style={{ height: 10 }} />
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>Your Score</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: C.white, fontFamily: "'Barlow Condensed',sans-serif" }}>{p?.overall_score ?? '—'}</div>
                    </div>
                    <div style={{ fontSize: 20, color: C.dimmer }}>vs</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>Team Average</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: C.white, fontFamily: "'Barlow Condensed',sans-serif" }}>{Math.round(tc.individual_vs_team.score_diff + (p?.overall_score || 0))}</div>
                    </div>
                    <div style={{ padding: '6px 14px', borderRadius: 8, background: tc.individual_vs_team.is_above_average ? C.green + '18' : C.red + '18', border: `1px solid ${tc.individual_vs_team.is_above_average ? C.green : C.red}44` }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: tc.individual_vs_team.is_above_average ? C.green : C.red }}>
                        {tc.individual_vs_team.is_above_average ? '↑ Above' : '↓ Below'} ({tc.individual_vs_team.score_diff > 0 ? '+' : ''}{tc.individual_vs_team.score_diff})
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
