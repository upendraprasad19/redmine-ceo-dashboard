// Self-registration multi-step wizard. Phase 6a.
// Steps: pick → confirm → credentials → channel → verifying_email|verifying_telegram → done
// Keep it flat and readable; one file, no helpers outside the module.
import { useEffect, useMemo, useRef, useState } from 'react';
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

const USERNAME_RE = /^[a-zA-Z0-9._-]+$/;

export default function RegisterPage() {
  const router = useRouter();

  const [step, setStep] = useState('pick');
  const [candidates, setCandidates] = useState([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [query, setQuery] = useState('');
  const [candidate, setCandidate] = useState(null);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [finalizeToken, setFinalizeToken] = useState(null);

  const [otp, setOtp] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(null);

  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Phase 7b: one-click approval token flow. When present, skip the name
  // picker entirely — the candidate is locked by the signed token.
  const [reqToken, setReqToken] = useState(null);
  const [tokenError, setTokenError] = useState(null); // 'BAD_TOKEN' | 'ALREADY_REGISTERED'

  const pollRef = useRef(null);

  // Phase 7b: if URL has ?req=<token>, pre-fill the wizard from the token.
  useEffect(() => {
    if (!router.isReady) return;
    const token = typeof router.query.req === 'string' ? router.query.req : null;
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/auth/register/candidate-from-token?token=${encodeURIComponent(token)}`);
        const body = await r.json();
        if (cancelled) return;
        if (r.ok && body.candidate) {
          setCandidate(body.candidate);
          setEmail(body.candidate.email || '');
          setReqToken(token);
          setStep('confirm');
        } else if (body.error === 'ALREADY_REGISTERED') {
          setTokenError('ALREADY_REGISTERED');
        } else {
          setTokenError('BAD_TOKEN');
        }
      } catch {
        if (!cancelled) setTokenError('BAD_TOKEN');
      }
    })();
    return () => { cancelled = true; };
  }, [router.isReady, router.query.req]);

  // Load candidates once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/register/candidates');
        const body = await r.json();
        if (cancelled) return;
        if (r.ok) {
          setCandidates(body.candidates || []);
        } else {
          setError(body.message || 'Failed to load candidates');
        }
      } catch {
        if (!cancelled) setError('Network error loading candidates');
      } finally {
        if (!cancelled) setLoadingCandidates(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Polling for Telegram verification.
  useEffect(() => {
    if (step !== 'verifying_telegram') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    async function tick() {
      try {
        const r = await fetch(`/api/auth/register/status?code=${encodeURIComponent(code)}`);
        const body = await r.json();
        if (!r.ok) return; // transient — keep polling
        if (body.status === 'expired' || body.status === 'consumed') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setError('Registration expired. Please start over.');
          return;
        }
        if (body.status === 'ready' && body.verified_channel === 'telegram') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          await doFinalize(body.finalize_token);
        }
      } catch (e) {
        console.error('status poll error', e);
      }
    }

    pollRef.current = setInterval(tick, 2000);
    tick();
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, code]);

  // Countdown timer for expires_at — force re-render each second.
  const [, tickTock] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const iv = setInterval(() => tickTock(x => x + 1), 1000);
    return () => clearInterval(iv);
  }, [expiresAt]);

  const remainingMs = expiresAt ? new Date(expiresAt).getTime() - Date.now() : null;
  const remainingLabel = remainingMs != null
    ? (remainingMs > 0
        ? `${String(Math.floor(remainingMs / 60000)).padStart(2, '0')}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`
        : '00:00')
    : null;
  const expired = remainingMs != null && remainingMs <= 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.team || '').toLowerCase().includes(q)
    );
  }, [candidates, query]);

  // ----- API calls --------------------------------------------------------

  async function doStart() {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/register/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redmine_user_id: candidate.id,
          username,
          password,
          email,
          ...(reqToken ? { req_token: reqToken } : {}),
        }),
      });
      const body = await r.json();
      if (r.ok) {
        setCode(body.code);
        setExpiresAt(body.expires_at);
        setStep('channel');
      } else {
        if (body.error === 'ALREADY_REGISTERED') setError('That username or Redmine account is already registered.');
        else if (body.error === 'RATE_LIMITED') setError(`Too many attempts. Try again in ${body.retry_after || 'a while'} seconds.`);
        else if (body.error === 'INVALID_INPUT') setError(body.message || 'Invalid input');
        else setError(body.message || 'Could not start registration');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function doSendEmailOtp() {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/register/send-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = await r.json();
      if (r.ok) {
        setEmailSent(true);
      } else {
        if (body.error === 'EMAIL_FAILED') setError("Couldn't send the email. Try again in a moment.");
        else if (body.error === 'RATE_LIMITED') setError(`Too many OTP requests. Try again in ${body.retry_after || 'a while'} seconds.`);
        else if (body.error === 'SESSION_EXPIRED') setError('Registration expired. Please start over.');
        else setError(body.message || 'Failed to send code');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function doVerifyEmail(e) {
    e?.preventDefault();
    if (otp.length !== 6) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/register/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, otp }),
      });
      const body = await r.json();
      if (r.ok) {
        // Fetch finalize_token via /status and finalize.
        const sr = await fetch(`/api/auth/register/status?code=${encodeURIComponent(code)}`);
        const sbody = await sr.json();
        if (sr.ok && sbody.status === 'ready' && sbody.finalize_token) {
          await doFinalize(sbody.finalize_token);
        } else {
          setError(sbody.message || 'Verified, but could not finalize. Please try again.');
        }
      } else {
        if (body.error === 'BAD_OTP') {
          setAttemptsLeft(body.attempts_left);
          setError(`Incorrect code — ${body.attempts_left ?? 0} tries left`);
          setOtp('');
        } else if (body.error === 'OTP_EXPIRED') {
          setError('That code has expired. Click Resend.');
        } else if (body.error === 'LOCKED') {
          setError('Too many wrong attempts. Start registration over.');
        } else if (body.error === 'SESSION_EXPIRED') {
          setError('Registration session expired. Please start over.');
        } else {
          setError(body.message || 'Verification failed');
        }
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function doFinalize(token) {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/register/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, finalize_token: token }),
      });
      const body = await r.json();
      if (r.ok) {
        setFinalizeToken(token);
        setStep('done');
        setTimeout(() => router.push('/'), 1000);
      } else {
        if (body.error === 'ALREADY_REGISTERED') setError('This account is already registered.');
        else if (body.error === 'BAD_TOKEN') setError('Verification token expired. Please re-verify.');
        else if (body.error === 'SESSION_EXPIRED') setError('Registration expired. Please start over.');
        else setError(body.message || 'Could not finalize');
      }
    } catch {
      setError('Network error finalizing registration.');
    } finally {
      setBusy(false);
    }
  }

  function resetFlow() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setStep('pick');
    setCandidate(null);
    setQuery('');
    setEmail('');
    setUsername('');
    setPassword('');
    setPasswordConfirm('');
    setCode(null);
    setExpiresAt(null);
    setFinalizeToken(null);
    setOtp('');
    setEmailSent(false);
    setAttemptsLeft(null);
    setError(null);
    setBusy(false);
  }

  function copyTelegramCmd() {
    const s = `/verify ${code}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }).catch(() => { setCopied(false); });
    }
  }

  // ----- Styles (inline, cloned from login/forgot-password) ----------------

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

  // Step headings
  const stepIdx = {
    pick: '1 of 5', confirm: '2 of 5', credentials: '3 of 5',
    channel: '4 of 5', verifying_email: '5 of 5', verifying_telegram: '5 of 5',
  }[step];

  // Credentials validation (instant feedback)
  const usernameOk = username.length >= 3 && username.length <= 32 && USERNAME_RE.test(username);
  const passwordOk = password.length >= 8;
  const matchOk = password.length > 0 && password === passwordConfirm;
  const credsOk = usernameOk && passwordOk && matchOk;

  // Phase 7b: full-page error screens for an invalid/expired or
  // already-registered approval link.
  if (tokenError) {
    const isAlready = tokenError === 'ALREADY_REGISTERED';
    return (
      <div style={pageWrap}>
        <div style={{ width: '100%', maxWidth: 460 }}>
          <div style={{ textAlign: 'center', marginBottom: 30 }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', color: C.dimmer, textTransform: 'uppercase', marginBottom: 6 }}>Create Account</div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 700, color: C.white }}>RedMine Dashboard</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.white, marginBottom: 6 }}>
              {isAlready ? 'Already registered' : 'Link not valid'}
            </div>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 18 }}>
              {isAlready
                ? 'This account is already registered. Sign in instead.'
                : 'This approval link is invalid or expired. Please contact your project manager.'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={btn(true)} onClick={() => router.push('/login')}>Go to sign-in</button>
              {!isAlready && (
                <button style={subtleBtn} onClick={() => router.push('/register/request-access')}>
                  Request access
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', color: C.dimmer, textTransform: 'uppercase', marginBottom: 6 }}>Create Account</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 700, color: C.white }}>RedMine Dashboard</div>
        </div>

        <div style={cardStyle}>
          {stepIdx && (
            <div style={{ fontSize: 13, fontWeight: 600, color: C.white, marginBottom: 6 }}>Step {stepIdx}</div>
          )}

          {/* STEP 1 — pick */}
          {step === 'pick' && (
            <>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 18 }}>Choose your name from the ThinkingCode roster.</div>
              <div style={label}>Search by name or team</div>
              <input
                style={{ ...input, marginBottom: 10 }}
                placeholder="Start typing…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus
              />
              <div style={{ maxHeight: 240, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, background: C.bg }}>
                {loadingCandidates && <div style={{ padding: 14, color: C.dim, fontSize: 12 }}>Loading…</div>}
                {!loadingCandidates && filtered.length === 0 && (
                  <div style={{ padding: 14, color: C.dim, fontSize: 12 }}>No matches.</div>
                )}
                {!loadingCandidates && filtered.map(c => (
                  <div
                    key={c.id}
                    onClick={() => setCandidate(c)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', cursor: 'pointer',
                      background: candidate?.id === c.id ? 'rgba(26,110,245,0.15)' : 'transparent',
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    <div>
                      <div style={{ color: C.white, fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>Role: {c.suggested_role}</div>
                    </div>
                    {c.team && (
                      <span style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 6,
                        background: 'rgba(255,255,255,0.05)', color: C.dim,
                        border: `1px solid ${C.border}`,
                      }}>{c.team}</span>
                    )}
                  </div>
                ))}
              </div>
              {error && <ErrBox msg={error} />}
              <div style={{ marginTop: 18 }}>
                <button
                  style={btn(!!candidate && !busy)}
                  disabled={!candidate || busy}
                  onClick={() => { setEmail(candidate.email || ''); setError(null); setStep('confirm'); }}
                >
                  Continue
                </button>
              </div>
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <a href="/register/request-access" style={{ fontSize: 11, color: C.dim, textDecoration: 'none' }}>
                  My name isn't listed → Request access
                </a>
              </div>
            </>
          )}

          {/* STEP 2 — confirm */}
          {step === 'confirm' && candidate && (
            <>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 18 }}>Confirm your identity.</div>
              <div style={{
                background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: 14, marginBottom: 18,
              }}>
                <div style={{ fontSize: 12, color: C.dim }}>You're registering as</div>
                <div style={{ fontSize: 16, color: C.white, fontWeight: 600, margin: '4px 0' }}>{candidate.name}</div>
                <div style={{ fontSize: 11, color: C.dim }}>
                  Role: <span style={{ color: C.white }}>{candidate.suggested_role}</span>
                  {candidate.team && <>  ·  Team: <span style={{ color: C.white }}>{candidate.team}</span></>}
                </div>
              </div>

              <div style={label}>Email</div>
              <input
                style={{ ...input, marginBottom: 6 }}
                value={email}
                onChange={e => setEmail(e.target.value)}
                type="email"
                autoFocus
              />
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 16 }}>
                We'll send a verification code here if you choose the email channel.
              </div>

              {error && <ErrBox msg={error} />}

              <div style={{ display: 'flex', gap: 10 }}>
                {!reqToken && (
                  <button style={subtleBtn} onClick={() => { setError(null); setStep('pick'); }}>← Back</button>
                )}
                <button
                  style={btn(!!email && !busy)}
                  disabled={!email || busy}
                  onClick={() => { setError(null); setStep('credentials'); }}
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {/* STEP 3 — credentials */}
          {step === 'credentials' && (
            <>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 18 }}>Pick a username and password.</div>

              <div style={label}>Username</div>
              <input
                style={{ ...input, marginBottom: 4 }}
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="jane.doe"
                autoComplete="username"
                autoFocus
              />
              <div style={{ fontSize: 10, color: username && !usernameOk ? C.red : C.dim, marginBottom: 14 }}>
                3–32 chars. Letters, digits, dot, underscore, hyphen.
              </div>

              <div style={label}>Password</div>
              <input
                style={{ ...input, marginBottom: 4 }}
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <div style={{ fontSize: 10, color: password && !passwordOk ? C.red : C.dim, marginBottom: 14 }}>
                At least 8 characters.
              </div>

              <div style={label}>Confirm password</div>
              <input
                style={{ ...input, marginBottom: 4 }}
                type="password"
                value={passwordConfirm}
                onChange={e => setPasswordConfirm(e.target.value)}
                autoComplete="new-password"
              />
              <div style={{ fontSize: 10, color: passwordConfirm && !matchOk ? C.red : C.dim, marginBottom: 14 }}>
                {passwordConfirm && !matchOk ? 'Passwords do not match.' : 'Re-enter the password.'}
              </div>

              {error && <ErrBox msg={error} />}

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button style={subtleBtn} onClick={() => { setError(null); setStep('confirm'); }} disabled={busy}>← Back</button>
                <button
                  style={btn(credsOk && !busy)}
                  disabled={!credsOk || busy}
                  onClick={doStart}
                >
                  {busy ? 'Starting…' : 'Continue'}
                </button>
              </div>
            </>
          )}

          {/* STEP 4 — channel picker */}
          {step === 'channel' && (
            <>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 18 }}>
                How would you like to verify?
                {remainingLabel && (
                  <span style={{ marginLeft: 8, color: expired ? C.red : C.amber }}>
                    · Expires in {remainingLabel}
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
                <ChannelCard
                  title="Telegram"
                  desc="Use @ThinkingCodeBot to verify in one message."
                  cta="Use Telegram →"
                  onClick={() => { setError(null); setStep('verifying_telegram'); }}
                  disabled={busy || expired}
                />
                <ChannelCard
                  title="Email"
                  desc={`Send a 6-digit code to ${email}.`}
                  cta="Send code →"
                  onClick={async () => { setError(null); setEmailSent(false); setStep('verifying_email'); await doSendEmailOtp(); }}
                  disabled={busy || expired}
                />
              </div>

              {expired && (
                <div style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>
                  Registration expired. Please start over.
                </div>
              )}
              {error && <ErrBox msg={error} />}

              <div style={{ display: 'flex', gap: 10 }}>
                <button style={subtleBtn} onClick={resetFlow}>← Start over</button>
              </div>
            </>
          )}

          {/* STEP 5a — verifying_telegram */}
          {step === 'verifying_telegram' && (
            <>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>
                In @ThinkingCodeBot on Telegram, send the line below.
                {remainingLabel && (
                  <span style={{ marginLeft: 8, color: expired ? C.red : C.amber }}>
                    · {remainingLabel}
                  </span>
                )}
              </div>

              <pre style={{
                background: C.bg, border: `1px solid ${C.borderHi}`, borderRadius: 10,
                padding: '14px 16px', color: C.white, fontSize: 13,
                fontFamily: "'Menlo', 'Consolas', monospace", margin: 0, overflowX: 'auto',
              }}>
                /verify {code}
              </pre>

              <div style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 16 }}>
                <button style={subtleBtn} onClick={copyTelegramCmd}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 11, color: C.dim,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: C.blue, display: 'inline-block',
                    animation: 'pulse 1.2s ease-in-out infinite',
                  }} />
                  Waiting for Telegram…
                </div>
              </div>

              {expired && (
                <div style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>
                  Registration expired. Please start over.
                </div>
              )}
              {error && <ErrBox msg={error} />}

              <div style={{ display: 'flex', gap: 10 }}>
                <button style={subtleBtn} onClick={() => { setError(null); setStep('channel'); }}>← Use email instead</button>
                {(expired || error) && (
                  <button style={btn(true)} onClick={resetFlow}>Start over</button>
                )}
              </div>

              <style jsx>{`
                @keyframes pulse {
                  0%, 100% { opacity: 0.35; transform: scale(0.9); }
                  50% { opacity: 1; transform: scale(1.1); }
                }
              `}</style>
            </>
          )}

          {/* STEP 5b — verifying_email */}
          {step === 'verifying_email' && (
            <>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>
                {emailSent
                  ? <>Code sent to <span style={{ color: C.white }}>{email}</span>. Expires in 10 minutes.</>
                  : 'Sending code…'}
                {remainingLabel && (
                  <span style={{ marginLeft: 8, color: expired ? C.red : C.amber }}>
                    · Session {remainingLabel}
                  </span>
                )}
              </div>

              <form onSubmit={doVerifyEmail}>
                <div style={label}>6-digit code</div>
                <input
                  style={{
                    ...input,
                    letterSpacing: '0.4em',
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontSize: 20, textAlign: 'center', marginBottom: 14,
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoFocus
                  disabled={busy || !emailSent}
                />

                {error && <ErrBox msg={error} />}

                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <button
                    type="submit"
                    style={btn(otp.length === 6 && !busy && emailSent)}
                    disabled={otp.length !== 6 || busy || !emailSent}
                  >
                    {busy ? 'Verifying…' : 'Verify'}
                  </button>
                  <button
                    type="button"
                    style={subtleBtn}
                    onClick={() => { setOtp(''); setError(null); doSendEmailOtp(); }}
                    disabled={busy}
                  >
                    Resend
                  </button>
                </div>
              </form>

              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button style={subtleBtn} onClick={() => { setError(null); setOtp(''); setStep('channel'); }}>← Use Telegram instead</button>
                {(error === 'Too many wrong attempts. Start registration over.' ||
                  error === 'Registration session expired. Please start over.') && (
                  <button style={btn(true)} onClick={resetFlow}>Start over</button>
                )}
              </div>
            </>
          )}

          {/* STEP 6 — done */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: 14, color: C.green, fontWeight: 600, marginBottom: 6 }}>You're in</div>
              <div style={{ fontSize: 12, color: C.dim }}>Loading the dashboard…</div>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <a href="/login" style={{ fontSize: 11, color: C.dim, textDecoration: 'none' }}>← Back to sign-in</a>
        </div>
      </div>
    </div>
  );
}

function ErrBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      background: '#E03E3E12', border: '1px solid #E03E3E44',
      borderRadius: 8, padding: '9px 12px',
      fontSize: 12, color: '#E03E3E', marginTop: 12, marginBottom: 4,
    }}>
      {msg}
    </div>
  );
}

function ChannelCard({ title, desc, cta, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
        background: '#0A1628', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10, padding: 14, textAlign: 'left',
        color: '#F0F4FF', fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'rgba(240,244,255,0.45)', lineHeight: 1.4 }}>{desc}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: '#1A6EF5', fontWeight: 600 }}>{cta}</div>
    </button>
  );
}
