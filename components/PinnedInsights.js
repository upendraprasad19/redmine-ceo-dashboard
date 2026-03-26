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

const severityColors = {
  critical: C.red,
  warning: C.amber,
  info: C.blueLight,
};

const severityIcons = {
  critical: (
    <svg width="14" height="14" fill="none" stroke={C.red} strokeWidth="2" viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  warning: (
    <svg width="14" height="14" fill="none" stroke={C.amber} strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  info: (
    <svg width="14" height="14" fill="none" stroke={C.blueLight} strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
    </svg>
  ),
};

export default function PinnedInsights({ currentUser }) {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInsights();
  }, []);

  async function fetchInsights() {
    try {
      const res = await fetch("/api/insights");
      if (res.ok) {
        const data = await res.json();
        setInsights(data.insights || []);
      }
    } catch (e) {
      console.error("Failed to fetch insights:", e);
    } finally {
      setLoading(false);
    }
  }

  async function dismissInsight(id) {
    setInsights(prev => prev.filter(ins => ins.id !== id));
    try {
      await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (e) {
      console.error("Failed to dismiss insight:", e);
      // Refetch to restore state
      fetchInsights();
    }
  }

  if (loading || insights.length === 0) return null;

  return (
    <div style={{
      display: "flex", gap: 12, overflowX: "auto",
      paddingBottom: 4, marginBottom: 20,
    }}>
      {insights.map(insight => {
        const color = severityColors[insight.severity] || C.blueLight;
        const icon = severityIcons[insight.severity] || severityIcons.info;

        return (
          <div
            key={insight.id}
            style={{
              flex: "0 0 auto",
              minWidth: 260, maxWidth: 340,
              background: C.card,
              border: `1px solid ${color}44`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 10,
              padding: "14px 16px",
              position: "relative",
              animation: "fadeIn .4s ease",
            }}
          >
            {/* Dismiss button */}
            <button
              onClick={() => dismissInsight(insight.id)}
              style={{
                position: "absolute", top: 10, right: 10,
                background: "none", border: "none",
                color: C.dimmer, fontSize: 16, cursor: "pointer",
                lineHeight: 1, padding: 2,
                transition: "color .15s",
              }}
              onMouseEnter={e => e.currentTarget.style.color = C.white}
              onMouseLeave={e => e.currentTarget.style.color = C.dimmer}
            >
              &times;
            </button>

            {/* Severity badge + title */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingRight: 20 }}>
              {icon}
              <div style={{
                fontSize: 12, fontWeight: 700, color: C.white,
                lineHeight: 1.3,
              }}>
                {insight.title}
              </div>
            </div>

            {/* Body */}
            <div style={{
              fontSize: 11, color: C.dim, lineHeight: 1.6,
              maxHeight: 60, overflow: "hidden",
            }}>
              {insight.body}
            </div>

            {/* Type badge */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              marginTop: 10,
              background: color + "12",
              border: `1px solid ${color}33`,
              borderRadius: 4, padding: "2px 8px",
            }}>
              <span style={{
                fontSize: 9, color, fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.08em",
              }}>
                {insight.insight_type || insight.severity}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
