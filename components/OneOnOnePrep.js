import React, { useState, useEffect } from "react";

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
};

export default function OneOnOnePrep({ person, onClose }) {
  const [loading, setLoading] = useState(true);
  const [talkingPoints, setTalkingPoints] = useState("");
  const [dataSummary, setDataSummary] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!person?.id) return;
    generateTalkingPoints();
  }, [person?.id]);

  async function generateTalkingPoints() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/one-on-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: person.id }),
      });

      if (res.ok) {
        const data = await res.json();
        setTalkingPoints(data.talking_points);
        setDataSummary(data.data_summary);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to generate talking points");
      }
    } catch (e) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(talkingPoints);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = talkingPoints;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (!person) return null;

  const initials = person.initials || person.name?.split(" ").map(n => n[0]).join("").slice(0, 2) || "??";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div style={{
        position: "absolute", inset: 0,
        background: "rgba(3,11,21,0.85)",
        backdropFilter: "blur(6px)",
      }}/>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "relative",
          background: C.surface,
          border: `1px solid ${C.borderHi}`,
          borderRadius: 20,
          padding: "36px 40px",
          width: 620, maxWidth: "90vw",
          maxHeight: "85vh",
          overflowY: "auto",
          animation: "fadeIn .3s ease",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 20, right: 20,
            background: "none", border: "none",
            color: C.dimmer, fontSize: 20, cursor: "pointer",
          }}
        >
          &#x2715;
        </button>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
            background: C.card, border: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 700, color: C.blueLight,
            fontFamily: "'Barlow Condensed',sans-serif",
          }}>
            {initials}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 20, fontWeight: 700, color: C.white,
              fontFamily: "'Barlow Condensed',sans-serif",
            }}>
              1-on-1 Prep: {person.name}
            </div>
            <div style={{ fontSize: 12, color: C.dimmer, marginTop: 3 }}>
              {person.role} · {person.team}
            </div>
          </div>
          <div style={{
            background: C.blue + "18", border: `1px solid ${C.blue}44`,
            borderRadius: 8, padding: "6px 14px",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="12" height="12" fill="none" stroke={C.blueLight} strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 2a7 7 0 0 1 7 7v1a7 7 0 0 1-14 0V9a7 7 0 0 1 7-7z"/>
              <path d="M8 21h8M12 17v4"/>
            </svg>
            <span style={{ fontSize: 11, color: C.blueLight, fontWeight: 600 }}>AI Generated</span>
          </div>
        </div>

        {/* Quick data summary */}
        {dataSummary && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10,
            marginBottom: 24,
          }}>
            {[
              { label: "Open", val: dataSummary.open_tickets, color: C.white },
              { label: "Blocked", val: dataSummary.blocked, color: dataSummary.blocked > 0 ? C.red : C.green },
              { label: "Overdue", val: dataSummary.overdue, color: dataSummary.overdue > 0 ? C.red : C.green },
              { label: "Hrs/Week", val: `${dataSummary.hours_this_week}h`, color: C.blueLight },
              { label: "Hrs/Month", val: `${dataSummary.hours_this_month}h`, color: C.green },
            ].map(s => (
              <div key={s.label} style={{
                background: C.bg, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: "12px 10px", textAlign: "center",
              }}>
                <div style={{
                  fontFamily: "'Barlow Condensed',sans-serif",
                  fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1,
                }}>{s.val}</div>
                <div style={{
                  fontSize: 9, color: C.dimmer, marginTop: 5,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", padding: "60px 0", gap: 16,
          }}>
            <div style={{
              width: 36, height: 36,
              border: `3px solid ${C.blue}22`, borderTopColor: C.blue,
              borderRadius: "50%", animation: "spin 1s linear infinite",
            }}/>
            <div style={{ fontSize: 13, color: C.blue, fontWeight: 600 }}>
              Generating talking points...
            </div>
            <div style={{ fontSize: 11, color: C.dimmer }}>
              Analyzing tickets, hours, and activity data
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div style={{
            background: C.red + "12", border: `1px solid ${C.red}44`,
            borderRadius: 10, padding: "16px 20px", marginBottom: 20,
          }}>
            <div style={{ fontSize: 13, color: C.red, marginBottom: 8 }}>{error}</div>
            <button
              onClick={generateTalkingPoints}
              style={{
                background: C.red + "22", border: `1px solid ${C.red}55`,
                color: C.red, borderRadius: 6, padding: "6px 14px",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Talking points content */}
        {!loading && !error && talkingPoints && (
          <>
            <div style={{
              background: C.bg, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: "20px 24px",
              fontSize: 13, color: C.dim, lineHeight: 1.8,
              whiteSpace: "pre-wrap",
            }}>
              {talkingPoints}
            </div>

            {/* Actions */}
            <div style={{
              display: "flex", justifyContent: "flex-end", gap: 10,
              marginTop: 20,
            }}>
              <button
                onClick={generateTalkingPoints}
                style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  color: C.dim, borderRadius: 8, padding: "10px 18px",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                  fontFamily: "'Barlow', sans-serif",
                  transition: "all .15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderHi; e.currentTarget.style.color = C.white; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.92-10.44l5.58 5.58"/>
                </svg>
                Regenerate
              </button>
              <button
                onClick={handleCopy}
                style={{
                  background: copied ? C.green : C.blue,
                  border: "none",
                  color: C.white, borderRadius: 8, padding: "10px 18px",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                  fontFamily: "'Barlow', sans-serif",
                  transition: "all .15s",
                }}
              >
                {copied ? (
                  <>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    Copy to Clipboard
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
