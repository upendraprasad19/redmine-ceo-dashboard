// Access-request form for users who aren't in the ThinkingCode roster.
// Two-step flow: form -> submitted (with self-service status-check widget).
// Phase 6b. Matches the dark-theme inline-styled palette used by
// pages/login.js and pages/register.js.
import { useState } from 'react';

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 120;
const MAX_TEAM = 80;
const MAX_MSG  = 1000;

export default function RequestAccessPage() {
  const [step, setStep]                 = useState('form'); // 'form' | 'submitted' | 'already_approved'
  const [fullName, setFullName]         = useState('');
  const [email, setEmail]               = useState('');
  const [team, setTeam]                 = useState('');
  const [message, setMessage]           = useState('');
  const [statusResult, setStatusResult] = useState(null);
  const [error, setError]               = useState(null);
  const [busy, setBusy]                 = useState(false);

  // Any input change clears the error banner.
  const clearErr = () => { if (error) setError(null); };
  const onNameChange  = (e) => { setFullName(e.target.value.slice(0, MAX_NAME)); clearErr(); };
  const onEmailChange = (e) => { setEmail(e.target.value); clearErr(); };
  const onTeamChange  = (e) => { setTeam(e.target.value.slice(0, MAX_TEAM)); clearErr(); };
  const onMsgChange   = (e) => { setMessage(e.target.value.slice(0, MAX_MSG)); clearErr(); };

  async function handleSubmit(e) {
    e?.preventDefault();
    if (busy) return;

    const name = fullName.trim();
    const addr = email.trim();

    if (!name) { setError('Please enter your full name.'); return; }
    if (!addr) { setError('Please enter your email.'); return; }
    if (!EMAIL_RE.test(addr)) { setError("That email doesn't look right."); return; }

    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/register/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: name,
          email: addr,
          team: team.trim() || undefined,
          message: message.trim() || undefined,
        }),
      });
      const body = await r.json().catch(() => ({}));

      if (r.ok && body.ok) {
        if (body.duplicate && body.status === 'approved') {
          setStep('already_approved');
        } else {
          setStep('submitted');
        }
        return;
      }

      if (r.status === 429 || body.error === 'RATE_LIMITED') {
        const secs = body.retry_after || 'a few';
        setError(`Too many requests. Try again in ${secs}s.`);
      } else if (body.error === 'INVALID_INPUT') {
        setError(body.message || 'Please check your input.');
      } else {
        setError(body.message || 'Could not submit your request. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckStatus() {
    if (busy) return;
    const addr = email.trim();
    if (!addr || !EMAIL_RE.test(addr)) {
      setStatusResult({ kind: 'error', text: "That email doesn't look right." });
      return;
    }
    setBusy(true);
    setStatusResult(null);
    try {
      const r = await fetch(
        `/api/auth/register/request-access/status?email=${encodeURIComponent(addr)}`
      );
      const body = await r.json().catch(() => ({}));

      if (r.status === 429 || body.error === 'RATE_LIMITED') {
        const secs = body.retry_after || 'a few';
        setStatusResult({ kind: 'error', text: `Too many checks. Try again in ${secs}s.` });
        return;
      }
      if (!r.ok) {
        setStatusResult({ kind: 'error', text: body.message || 'Could not check status.' });
        return;
      }

      if (!body.found) {
        setStatusResult({
          kind: 'info',
          text: "We don't have a record of a request under this email.",
        });
        return;
      }

      switch (body.status) {
        case 'pending':
          setStatusResult({ kind: 'pending',  text: 'Your request is pending review.' });
          break;
        case 'approved':
          setStatusResult({ kind: 'approved', text: 'Approved — check your email for the setup link.' });
          break;
        case 'rejected':
          setStatusResult({ kind: 'rejected', text: 'Your request was not approved. Please contact your project manager for more info.' });
          break;
        case 'resolved':
          setStatusResult({ kind: 'approved', text: "Your access is now ready — check your email for the final setup link if you haven't clicked it." });
          break;
        default:
          setStatusResult({ kind: 'info', text: `Status: ${body.status}` });
      }
    } catch {
      setStatusResult({ kind: 'error', text: 'Network error. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  // ----- Styles (matched to pages/register.js) -----------------------------

  const pageWrap = {
    fontFamily: "'Barlow', sans-serif", background: C.bg, minHeight: '100vh',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  };
  const cardStyle = {
    width: '100%', maxWidth: 460, background: C.card,
    border: `1px solid ${error ? C.red + '44' : C.border}`,
    borderRadius: 16, padding: '32px 28px',
  };
  const input = {
    width: '100%', background: C.bg, border: `1px solid ${C.borderHi}`, borderRadius: 10,
    padding: '12px 16px', fontSize: 14, color: C.white, outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box',
  };
  const label = {
    fontSize: 9, letterSpacing: '0.13em', color: C.dimmer,
    textTransform: 'uppercase', fontWeight: 600, marginBottom: 8,
  };
  const btn = (enabled) => ({
    width: '100%', background: enabled ? C.blue : 'rgba(26,110,245,0.35)', border: 'none',
    borderRadius: 10, padding: 13, fontSize: 13, fontWeight: 600, color: C.white,
    cursor: enabled ? 'pointer' : 'not-allowed', letterSpacing: '0.03em',
    fontFamily: 'inherit',
  });
  const subtleBtn = {
    background: 'none', border: `1px solid ${C.borderHi}`, color: C.dim,
    borderRadius: 10, padding: '10px 16px', fontSize: 12, cursor: 'pointer',
    fontFamily: 'inherit',
  };

  const msgCount = message.length;

  return (
    <div style={pageWrap}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', color: C.dimmer, textTransform: 'uppercase', marginBottom: 6 }}>Request Access</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 700, color: C.white }}>RedMine Dashboard</div>
        </div>

        <div style={cardStyle}>

          {step === 'form' && (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.white, marginBottom: 6 }}>
                Request Dashboard Access
              </div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 20, lineHeight: 1.5 }}>
                Not in the name list yet? Give us a few details and we'll review your request.
              </div>

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 14 }}>
                  <div style={label}>Full name</div>
                  <input
                    style={input}
                    value={fullName}
                    onChange={onNameChange}
                    placeholder="Jane Doe"
                    maxLength={MAX_NAME}
                    autoFocus
                    disabled={busy}
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={label}>Email</div>
                  <input
                    style={input}
                    type="email"
                    value={email}
                    onChange={onEmailChange}
                    placeholder="you@company.com"
                    autoComplete="email"
                    disabled={busy}
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={label}>Team <span style={{ textTransform: 'none', letterSpacing: 0, color: C.dimmer, fontWeight: 400 }}>(optional)</span></div>
                  <input
                    style={input}
                    value={team}
                    onChange={onTeamChange}
                    placeholder="e.g. Backend, Design"
                    maxLength={MAX_TEAM}
                    disabled={busy}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ ...label, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span>Message <span style={{ textTransform: 'none', letterSpacing: 0, color: C.dimmer, fontWeight: 400 }}>(optional)</span></span>
                    <span style={{ letterSpacing: 0, color: msgCount >= MAX_MSG ? C.amber : C.dimmer, fontWeight: 400 }}>
                      {msgCount} / {MAX_MSG}
                    </span>
                  </div>
                  <textarea
                    style={{ ...input, minHeight: 96, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                    value={message}
                    onChange={onMsgChange}
                    placeholder="Anything your project manager should know…"
                    maxLength={MAX_MSG}
                    disabled={busy}
                  />
                </div>

                {error && <ErrBox msg={error} />}

                <button
                  type="submit"
                  style={btn(!busy)}
                  disabled={busy}
                >
                  {busy ? 'Submitting…' : 'Submit request'}
                </button>
              </form>

              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <a href="/register" style={{ fontSize: 11, color: C.dim, textDecoration: 'none' }}>
                  ← Back to registration
                </a>
              </div>
            </>
          )}

          {(step === 'submitted' || step === 'already_approved') && (
            <SubmittedCard
              email={email.trim()}
              alreadyApproved={step === 'already_approved'}
              busy={busy}
              statusResult={statusResult}
              onCheck={handleCheckStatus}
              styles={{ input, label, btn, subtleBtn }}
            />
          )}

        </div>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <a href="/login" style={{ fontSize: 11, color: C.dim, textDecoration: 'none' }}>← Back to sign-in</a>
        </div>
      </div>
    </div>
  );
}

function SubmittedCard({ email, alreadyApproved, busy, statusResult, onCheck, styles }) {
  const { input, label, btn, subtleBtn } = styles;

  return (
    <>
      {alreadyApproved && (
        <div style={{
          background: 'rgba(46,204,113,0.08)', border: `1px solid rgba(46,204,113,0.35)`,
          borderRadius: 8, padding: '10px 14px', marginBottom: 18,
          fontSize: 12, color: C.green, lineHeight: 1.5,
        }}>
          Your request was already approved. Check your email for the setup link
          (subject: <span style={{ color: C.white }}>"Your RedMine Dashboard access is ready"</span>).
          If you can't find it, it may be in spam.
        </div>
      )}

      <div style={{ fontSize: 15, fontWeight: 600, color: C.white, marginBottom: 6 }}>
        Request received
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginBottom: 20, lineHeight: 1.5 }}>
        {alreadyApproved ? (
          <>You've already requested access — we'll review it soon.</>
        ) : (
          <>
            We'll review your request and email you at{' '}
            <span style={{ color: C.white }}>{email}</span>. Keep an eye on your inbox
            (check spam if nothing arrives in a day).
          </>
        )}
      </div>

      <div style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
        padding: 16, marginBottom: 16,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.white, marginBottom: 4 }}>Check status</div>
        <div style={{ fontSize: 11, color: C.dim, marginBottom: 12 }}>
          See where your request stands.
        </div>

        <div style={label}>Email</div>
        <input
          style={{ ...input, marginBottom: 10, opacity: 0.85 }}
          value={email}
          readOnly
        />

        <button
          type="button"
          style={btn(!busy)}
          onClick={onCheck}
          disabled={busy}
        >
          {busy ? 'Checking…' : 'Check'}
        </button>

        {statusResult && <StatusBox result={statusResult} />}
      </div>

      <div style={{ textAlign: 'center' }}>
        <a href="/register" style={{ fontSize: 11, color: C.dim, textDecoration: 'none' }}>
          ← Back to registration
        </a>
      </div>
    </>
  );
}

const STATUS_TONE = {
  approved: { color: C.green, bg: 'rgba(46,204,113,0.08)',  border: 'rgba(46,204,113,0.35)' },
  pending:  { color: C.amber, bg: 'rgba(201,124,26,0.10)',  border: 'rgba(201,124,26,0.45)' },
  rejected: { color: C.red,   bg: 'rgba(224,62,62,0.08)',   border: 'rgba(224,62,62,0.45)'  },
  error:    { color: C.red,   bg: 'rgba(224,62,62,0.08)',   border: 'rgba(224,62,62,0.45)'  },
  info:     { color: C.dim,   bg: 'rgba(255,255,255,0.03)', border: C.border                },
};

function StatusBox({ result }) {
  const tone = STATUS_TONE[result.kind] || STATUS_TONE.info;
  return (
    <div style={{
      marginTop: 12,
      background: tone.bg, border: `1px solid ${tone.border}`,
      borderRadius: 8, padding: '10px 12px',
      fontSize: 12, color: tone.color, lineHeight: 1.5,
    }}>
      {result.text}
    </div>
  );
}

function ErrBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      background: '#E03E3E12', border: '1px solid #E03E3E44',
      borderRadius: 8, padding: '9px 12px',
      fontSize: 12, color: '#E03E3E', marginTop: 4, marginBottom: 12,
    }}>
      {msg}
    </div>
  );
}
