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
};

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [attempts, setAttempts] = useState(0);

  const from = router.query.from || '/';

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password || loading) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push(from);
      } else {
        const data = await res.json();
        setAttempts(a => a + 1);
        setError(data.error || 'Invalid password');
        setPassword('');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      fontFamily: "'Barlow', sans-serif",
      background: C.bg,
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
    }}>
      {/* Background grid texture */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none",
        backgroundImage: `radial-gradient(circle at 50% 0%, rgba(26,110,245,0.08) 0%, transparent 60%)`,
      }}/>

      <div style={{
        width: "100%", maxWidth: 400,
        animation: "fadeIn .4s ease",
      }}>
        {/* Logo mark */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 48, height: 48, borderRadius: 12, marginBottom: 20,
            background: "linear-gradient(135deg, rgba(26,110,245,0.3), rgba(26,110,245,0.1))",
            border: `1px solid rgba(26,110,245,0.4)`,
          }}>
            <svg width="22" height="22" fill="none" stroke={C.blue} strokeWidth="1.8" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1.5"/>
              <rect x="14" y="3" width="7" height="7" rx="1.5"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5"/>
              <rect x="14" y="14" width="7" height="7" rx="1.5"/>
            </svg>
          </div>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 11, fontWeight: 600, letterSpacing: "0.18em",
            color: C.dimmer, textTransform: "uppercase", marginBottom: 8,
          }}>Command Centre</div>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 28, fontWeight: 700, color: C.white,
            letterSpacing: "-0.01em", lineHeight: 1,
          }}>RedMine Dashboard</div>
        </div>

        {/* Card */}
        <div style={{
          background: C.card,
          border: `1px solid ${error ? C.red + "44" : C.border}`,
          borderRadius: 16, padding: "32px 28px",
          transition: "border-color .2s",
        }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: C.white,
            marginBottom: 4,
          }}>Restricted Access</div>
          <div style={{
            fontSize: 12, color: C.dimmer, marginBottom: 28, lineHeight: 1.5,
          }}>Enter your dashboard password to continue.</div>

          <form onSubmit={handleSubmit}>
            {/* Password field */}
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 9, letterSpacing: "0.13em", color: C.dimmer,
                textTransform: "uppercase", fontWeight: 600, marginBottom: 8,
              }}>Password</div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                autoFocus
                disabled={loading}
                style={{
                  width: "100%",
                  background: C.bg,
                  border: `1px solid ${error ? C.red + "66" : C.borderHi}`,
                  borderRadius: 10, padding: "12px 16px",
                  fontSize: 14, color: C.white,
                  outline: "none", transition: "border-color .15s",
                  fontFamily: "'Barlow', sans-serif",
                  letterSpacing: password ? "0.15em" : "normal",
                }}
                onFocus={e => e.target.style.borderColor = C.blue}
                onBlur={e => e.target.style.borderColor = error ? C.red + "66" : C.borderHi}
              />
            </div>

            {/* Error message */}
            {error && (
              <div style={{
                background: C.red + "12",
                border: `1px solid ${C.red}44`,
                borderRadius: 8, padding: "10px 14px",
                fontSize: 12, color: C.red, marginBottom: 16,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <svg width="14" height="14" fill="none" stroke={C.red} strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M12 8v4M12 16h.01"/>
                </svg>
                {error}
                {attempts >= 3 && (
                  <span style={{ marginLeft: 4, color: C.amber }}>
                    · Contact admin if locked out
                  </span>
                )}
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={!password || loading}
              style={{
                width: "100%",
                background: loading ? "rgba(26,110,245,0.5)" : C.blue,
                border: "none", borderRadius: 10, padding: "13px",
                fontSize: 13, fontWeight: 600, color: C.white,
                cursor: (!password || loading) ? "not-allowed" : "pointer",
                transition: "all .15s", letterSpacing: "0.03em",
                opacity: (!password || loading) ? 0.7 : 1,
                fontFamily: "'Barlow', sans-serif",
              }}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span style={{
                    width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)",
                    borderTopColor: C.white, borderRadius: "50%",
                    display: "inline-block", animation: "spin .6s linear infinite",
                  }}/>
                  Verifying...
                </span>
              ) : "Access Dashboard"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div style={{
          textAlign: "center", marginTop: 24,
          fontSize: 10, color: C.dimmer, letterSpacing: "0.06em",
        }}>
          Authorised personnel only · Session expires in 8 hours
        </div>
      </div>

    </div>
  );
}
