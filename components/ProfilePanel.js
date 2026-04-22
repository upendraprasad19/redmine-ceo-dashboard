import { useEffect, useState } from 'react';

const C = {
  bg: '#050d1a', card: '#0b1728', border: '#16253d', white: '#eaf1fb',
  dim: '#8aa0bb', dimmer: '#556a87', green: '#00e5a0', blue: '#0c6bff',
  blueLight: '#4aa3ff', red: '#ff5370', amber: '#ffb547',
};

function Avatar({ initials, size = 52 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${C.blue}, ${C.blueLight})`,
      color: C.white, fontSize: size * 0.4, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Barlow', sans-serif", letterSpacing: '0.02em',
    }}>{initials}</div>
  );
}

function Row({ label, value, valueColor = C.white }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 11, color: C.dimmer, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 12, color: valueColor, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.14em', color: C.dimmer, textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

export default function ProfilePanel({ open, onClose, onLogout }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  // Change password form
  const [pwOld, setPwOld] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwNew2, setPwNew2] = useState('');
  const [pwMsg, setPwMsg] = useState(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    fetch('/api/profile/snapshot').then(r => r.ok ? r.json() : Promise.reject(r)).then(setData).catch(e => setErr('Failed to load profile'));
  }, [open]);

  async function savePrefs(partial) {
    setSaving(true);
    try {
      const res = await fetch('/api/profile/prefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      if (res.ok) {
        const updated = await res.json();
        setData(d => d ? { ...d, me: { ...d.me, ...updated } } : d);
      }
    } finally { setSaving(false); }
  }

  async function submitPasswordChange(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pwNew !== pwNew2) return setPwMsg({ type: 'err', text: 'New passwords do not match' });
    if (pwNew.length < 6) return setPwMsg({ type: 'err', text: 'Password must be at least 6 characters' });
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: pwOld, newPassword: pwNew }),
    });
    const body = await res.json();
    if (!res.ok) return setPwMsg({ type: 'err', text: body.error || 'Failed' });
    setPwMsg({ type: 'ok', text: 'Password updated' });
    setPwOld(''); setPwNew(''); setPwNew2('');
  }

  if (!open) return null;

  const me = data?.me;
  const snap = data?.snapshot;

  const toggleChannel = (ch) => {
    const cur = me.notification_channels || [];
    const next = cur.includes(ch) ? cur.filter(x => x !== ch) : [...cur, ch];
    savePrefs({ notification_channels: next });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 900, animation: 'fadeIn .15s' }}
      />
      {/* Slide-in panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, maxWidth: '92vw',
        background: C.bg, borderLeft: `1px solid ${C.border}`, zIndex: 901,
        padding: '20px 22px 32px', overflowY: 'auto',
        boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
        animation: 'slideInRight .2s ease',
      }}>
        <style>{`@keyframes slideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } } @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }`}</style>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.14em', color: C.dimmer, textTransform: 'uppercase', fontWeight: 700 }}>Profile</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {err && <div style={{ color: C.red, padding: 12, background: C.red + '11', borderRadius: 8, marginTop: 12 }}>{err}</div>}

        {me && (
          <>
            {/* Identity card */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 10 }}>
              <Avatar initials={(me.display_name || '?').slice(0,2).toUpperCase()} size={56} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.white }}>{me.display_name}</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                  <span style={{ textTransform: 'capitalize' }}>{me.role.replace('_', ' ')}</span>
                  {me.team && <> · <span style={{ color: C.blueLight }}>{me.team}</span></>}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <Row label="Username" value={me.username} />
              <Row label="Email" value={me.email || '— not set'} valueColor={me.email ? C.white : C.dim} />
              <Row
                label="Telegram"
                value={me.telegram_id ? 'Linked ✓' : 'Not linked'}
                valueColor={me.telegram_id ? C.green : C.amber}
              />
            </div>

            {/* At-a-glance */}
            {snap && (
              <Section title={snap.scope === 'manager' ? 'At a glance — Company' : `At a glance — ${snap.team} team`}>
                {snap.scope === 'manager' ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      <Kpi label="Open" value={snap.open_tickets} color={C.white} />
                      <Kpi label="Overdue" value={snap.overdue} color={C.red} />
                      <Kpi label="No Log" value={snap.no_time_log_today} color={C.amber} />
                    </div>
                    {snap.topRisk?.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 10, color: C.dimmer, marginBottom: 6 }}>Projects with most overdue</div>
                        {snap.topRisk.map(r => (
                          <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12 }}>
                            <span style={{ color: C.white }}>{r.name}</span>
                            <span style={{ color: C.red, fontWeight: 600 }}>{r.overdue_count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      <Kpi label="Team Size" value={snap.team_size} color={C.white} />
                      <Kpi label="On Leave" value={snap.on_leave_today} color={C.amber} />
                      <Kpi label="Overdue" value={snap.team_overdue} color={C.red} />
                    </div>
                    {snap.topDev?.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 10, color: C.dimmer, marginBottom: 6 }}>Most-loaded team members</div>
                        {snap.topDev.map(r => (
                          <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12 }}>
                            <span style={{ color: C.white }}>{r.name}</span>
                            <span style={{ color: C.blueLight, fontWeight: 600 }}>{r.open_count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Section>
            )}

            {/* Notification channels */}
            <Section title="Notifications">
              <div style={{ display: 'flex', gap: 10 }}>
                <ChannelToggle
                  label="Telegram"
                  active={(me.notification_channels || []).includes('telegram')}
                  disabled={!me.telegram_id}
                  disabledHint="Link your Telegram account first"
                  onToggle={() => toggleChannel('telegram')}
                />
                <ChannelToggle
                  label="Email"
                  active={(me.notification_channels || []).includes('email')}
                  disabled={!me.email}
                  disabledHint="No email on file"
                  onToggle={() => toggleChannel('email')}
                />
              </div>
            </Section>

            {/* Briefing prefs */}
            <Section title="Morning briefing">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select
                  value={me.morning_briefing || 'none'}
                  onChange={e => savePrefs({ morning_briefing: e.target.value })}
                  style={selectStyle}
                >
                  <option value="none">Off</option>
                  <option value="short">Short</option>
                  <option value="detailed">Detailed</option>
                </select>
                <select
                  value={me.briefing_days || 'weekdays'}
                  onChange={e => savePrefs({ briefing_days: e.target.value })}
                  style={selectStyle}
                >
                  <option value="weekdays">Weekdays</option>
                  <option value="everyday">Every day</option>
                  <option value="never">Never</option>
                </select>
                <input
                  type="time"
                  value={(me.briefing_time || '09:00').slice(0,5)}
                  onChange={e => savePrefs({ briefing_time: e.target.value })}
                  style={{ ...selectStyle, width: 100 }}
                />
              </div>
              {saving && <div style={{ fontSize: 10, color: C.dimmer, marginTop: 6 }}>Saving…</div>}
            </Section>

            {/* Change password */}
            <Section title="Change password">
              <form onSubmit={submitPasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input type="password" placeholder="Current password" value={pwOld} onChange={e => setPwOld(e.target.value)} style={inputStyle} autoComplete="current-password" />
                <input type="password" placeholder="New password" value={pwNew} onChange={e => setPwNew(e.target.value)} style={inputStyle} autoComplete="new-password" />
                <input type="password" placeholder="Confirm new password" value={pwNew2} onChange={e => setPwNew2(e.target.value)} style={inputStyle} autoComplete="new-password" />
                {pwMsg && (
                  <div style={{ fontSize: 11, color: pwMsg.type === 'ok' ? C.green : C.red }}>{pwMsg.text}</div>
                )}
                <button type="submit" disabled={!pwOld || !pwNew || !pwNew2} style={{
                  background: C.blue, border: 'none', color: C.white, padding: '9px 14px',
                  borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  opacity: (!pwOld || !pwNew || !pwNew2) ? 0.5 : 1,
                }}>Update password</button>
              </form>
            </Section>

            {/* Sign out */}
            <Section title="">
              <button onClick={onLogout} style={{
                width: '100%', background: 'transparent', border: `1px solid ${C.red}55`,
                color: C.red, padding: '10px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>Sign out</button>
            </Section>
          </>
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, color: C.dimmer, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 700, color, lineHeight: 1.1, marginTop: 2 }}>{value ?? 0}</div>
    </div>
  );
}

function ChannelToggle({ label, active, disabled, disabledHint, onToggle }) {
  return (
    <button
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      title={disabled ? disabledHint : ''}
      style={{
        flex: 1, padding: '10px 12px',
        background: disabled ? C.card : (active ? C.blue + '22' : C.card),
        border: `1px solid ${disabled ? C.border : (active ? C.blue : C.border)}`,
        borderRadius: 8,
        color: disabled ? C.dimmer : (active ? C.white : C.dim),
        fontSize: 12, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'center',
      }}
    >
      {label} {active && !disabled && '✓'}
    </button>
  );
}

const inputStyle = {
  background: C.card, border: `1px solid ${C.border}`, color: C.white,
  padding: '9px 12px', borderRadius: 6, fontSize: 12, outline: 'none',
  fontFamily: 'inherit',
};
const selectStyle = {
  background: C.card, border: `1px solid ${C.border}`, color: C.white,
  padding: '7px 10px', borderRadius: 6, fontSize: 12, outline: 'none',
};
