import { useState } from 'react';
import { useRouter } from 'next/router';

const C = {
  bg:       "#030B15",
  surface:  "#070F1C",
  card:     "#0A1628",
  border:   "rgba(255,255,255,0.07)",
  borderHi: "rgba(255,255,255,0.16)",
  blue:     "#1A6EF5",
  white:    "#F0F4FF",
  dim:      "rgba(240,244,255,0.45)",
  dimmer:   "rgba(240,244,255,0.22)",
  red:      "#E03E3E",
  amber:    "#C97C1A",
  green:    "#2ECC71",
};

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [channels, setChannels] = useState({ telegramAvailable: false, emailAvailable: false });
  const [picked, setPicked] = useState([]); // ['telegram','email']
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState(null);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function fetchChannels(e) {
    e?.preventDefault();
    if (!username) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth/forgot-password/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const body = await r.json();
      setChannels(body);
      if (!body.telegramAvailable && !body.emailAvailable) {
        setStep('unavailable');
      } else {
        // Pre-select whichever is available; prefer both if both available
        const pre = [];
        if (body.telegramAvailable) pre.push('telegram');
        if (body.emailAvailable) pre.push('email');
        setPicked(pre);
        setStep(2);
      }
    } catch {
      setErr('Network error');
    } finally { setBusy(false); }
  }

  async function sendCode(e) {
    e?.preventDefault();
    if (picked.length === 0) return setErr('Pick at least one channel');
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth/forgot-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, channels: picked }),
      });
      if (r.ok) setStep(3);
      else setErr('Could not send code. Try again.');
    } catch { setErr('Network error'); } finally { setBusy(false); }
  }

  async function verifyCode(e) {
    e?.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth/forgot-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, code }),
      });
      const body = await r.json();
      if (r.ok && body.resetToken) {
        setResetToken(body.resetToken);
        setStep(4);
      } else {
        setErr(body.error || 'Invalid code');
      }
    } catch { setErr('Network error'); } finally { setBusy(false); }
  }

  async function submitNew(e) {
    e?.preventDefault();
    if (newPw !== newPw2) return setErr('Passwords do not match');
    if (newPw.length < 6) return setErr('Password must be at least 6 characters');
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword: newPw }),
      });
      if (r.ok) {
        setStep('done');
        setTimeout(() => router.push('/login'), 1800);
      } else {
        const body = await r.json();
        setErr(body.error || 'Reset failed');
      }
    } catch { setErr('Network error'); } finally { setBusy(false); }
  }

  const pageWrap = {
    fontFamily: "'Barlow', sans-serif", background: C.bg, minHeight: '100vh',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  };
  const cardStyle = {
    width: '100%', maxWidth: 420, background: C.card,
    border: `1px solid ${err ? C.red + '44' : C.border}`,
    borderRadius: 16, padding: '32px 28px',
  };
  const input = {
    width: '100%', background: C.bg, border: `1px solid ${C.borderHi}`, borderRadius: 10,
    padding: '12px 16px', fontSize: 14, color: C.white, outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box',
  };
  const btn = (enabled) => ({
    width: '100%', background: enabled ? C.blue : 'rgba(26,110,245,0.35)', border: 'none',
    borderRadius: 10, padding: 13, fontSize: 13, fontWeight: 600, color: C.white,
    cursor: enabled ? 'pointer' : 'not-allowed', letterSpacing: '0.03em',
    fontFamily: 'inherit',
  });

  return (
    <div style={pageWrap}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', color: C.dimmer, textTransform: 'uppercase', marginBottom: 6 }}>Reset Password</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 700, color: C.white }}>RedMine Dashboard</div>
        </div>

        <div style={cardStyle}>
          {step === 1 && (
            <form onSubmit={fetchChannels}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.white, marginBottom: 6 }}>Step 1 of 4</div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 20 }}>Enter your username to continue.</div>
              <input style={input} value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" autoFocus />
              {err && <ErrBox msg={err}/>}
              <div style={{ marginTop: 16 }}>
                <button type="submit" style={btn(!!username && !busy)} disabled={!username || busy}>{busy ? 'Checking…' : 'Continue'}</button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={sendCode}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.white, marginBottom: 6 }}>Step 2 of 4</div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Where should we send the 6-digit code?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
                <ChannelBox
                  label="Telegram"
                  selected={picked.includes('telegram')}
                  disabled={!channels.telegramAvailable}
                  onToggle={() => togglePick('telegram')}
                  hint={channels.telegramAvailable ? 'Linked account' : 'Not linked on this account'}
                />
                <ChannelBox
                  label="Email"
                  selected={picked.includes('email')}
                  disabled={!channels.emailAvailable}
                  onToggle={() => togglePick('email')}
                  hint={channels.emailAvailable ? 'Send to your work email' : 'No email on file'}
                />
              </div>
              {err && <ErrBox msg={err}/>}
              <button type="submit" style={btn(picked.length > 0 && !busy)} disabled={picked.length === 0 || busy}>{busy ? 'Sending…' : 'Send code'}</button>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={verifyCode}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.white, marginBottom: 6 }}>Step 3 of 4</div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 18 }}>Enter the 6-digit code we sent (expires in 15 min).</div>
              <input style={{ ...input, letterSpacing: '0.4em', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, textAlign: 'center' }} maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g,''))} placeholder="000000" autoFocus />
              {err && <ErrBox msg={err}/>}
              <div style={{ marginTop: 16 }}>
                <button type="submit" style={btn(code.length === 6 && !busy)} disabled={code.length !== 6 || busy}>{busy ? 'Verifying…' : 'Verify'}</button>
              </div>
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button type="button" onClick={() => { setCode(''); setErr(''); setStep(2); }} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 11 }}>← Resend to different channel</button>
              </div>
            </form>
          )}

          {step === 4 && (
            <form onSubmit={submitNew}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.white, marginBottom: 6 }}>Step 4 of 4</div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 18 }}>Set a new password.</div>
              <input type="password" style={{ ...input, marginBottom: 10 }} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="New password" autoFocus autoComplete="new-password" />
              <input type="password" style={input} value={newPw2} onChange={e => setNewPw2(e.target.value)} placeholder="Confirm password" autoComplete="new-password" />
              {err && <ErrBox msg={err}/>}
              <div style={{ marginTop: 16 }}>
                <button type="submit" style={btn(!!newPw && !!newPw2 && !busy)} disabled={!newPw || !newPw2 || busy}>{busy ? 'Saving…' : 'Save password'}</button>
              </div>
            </form>
          )}

          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: 14, color: C.green, fontWeight: 600, marginBottom: 6 }}>Password updated</div>
              <div style={{ fontSize: 12, color: C.dim }}>Redirecting to sign-in…</div>
            </div>
          )}

          {step === 'unavailable' && (
            <div style={{ padding: '10px 0' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.amber, marginBottom: 8 }}>No reset channels available</div>
              <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.5 }}>
                Neither Telegram nor an email address is on file for this username.
                Contact your admin to reset your password manually.
              </div>
              <div style={{ marginTop: 18 }}>
                <button onClick={() => router.push('/login')} style={btn(true)}>Back to sign-in</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <a href="/login" style={{ fontSize: 11, color: C.dim, textDecoration: 'none' }}>← Back to sign-in</a>
        </div>
      </div>
    </div>
  );

  function togglePick(ch) {
    setPicked(p => p.includes(ch) ? p.filter(x => x !== ch) : [...p, ch]);
  }
}

function ErrBox({ msg }) {
  return (
    <div style={{ background: '#E03E3E12', border: '1px solid #E03E3E44', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#E03E3E', marginTop: 12 }}>
      {msg}
    </div>
  );
}

function ChannelBox({ label, selected, disabled, onToggle, hint }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 16px', borderRadius: 10,
        background: disabled ? 'rgba(255,255,255,0.02)' : (selected ? 'rgba(26,110,245,0.15)' : '#0A1628'),
        border: `1px solid ${disabled ? 'rgba(255,255,255,0.05)' : (selected ? '#1A6EF5' : 'rgba(255,255,255,0.12)')}`,
        color: disabled ? 'rgba(240,244,255,0.25)' : '#F0F4FF',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
        transition: 'all .15s',
      }}
    >
      <div>
        <div>{label}</div>
        <div style={{ fontSize: 10, color: disabled ? 'rgba(240,244,255,0.22)' : 'rgba(240,244,255,0.45)', fontWeight: 400, marginTop: 2 }}>{hint}</div>
      </div>
      <div style={{ fontSize: 16, color: selected && !disabled ? '#1A6EF5' : 'transparent' }}>✓</div>
    </button>
  );
}
