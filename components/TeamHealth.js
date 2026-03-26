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

function scoreColor(score) {
  if (score < 40) return C.red;
  if (score < 70) return C.amber;
  return C.green;
}

function trendArrow(trend) {
  if (!trend) return { icon: "-", color: C.dimmer };
  const t = trend.toLowerCase();
  if (t === "rising" || t === "up" || t === "improving") {
    return {
      icon: (
        <svg width="12" height="12" fill="none" stroke={C.green} strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M18 15l-6-6-6 6"/>
        </svg>
      ),
      color: C.green,
      label: "Rising",
    };
  }
  if (t === "declining" || t === "down" || t === "dropping") {
    return {
      icon: (
        <svg width="12" height="12" fill="none" stroke={C.red} strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      ),
      color: C.red,
      label: "Declining",
    };
  }
  return {
    icon: (
      <svg width="12" height="12" fill="none" stroke={C.dimmer} strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="M5 12h14"/>
      </svg>
    ),
    color: C.dimmer,
    label: "Stable",
  };
}

export default function TeamHealth({ currentUser }) {
  const [health, setHealth] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHealth();
  }, []);

  async function fetchHealth() {
    try {
      const res = await fetch("/api/team-health");
      if (res.ok) {
        const data = await res.json();
        setHealth(data.health || []);
      }
    } catch (e) {
      console.error("Failed to fetch team health:", e);
    } finally {
      setLoading(false);
    }
  }

  if (loading || health.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {health.map(h => {
        const color = scoreColor(h.overall_score);
        const trend = trendArrow(h.trend);

        return (
          <div
            key={h.team}
            style={{
              background: C.bg,
              border: `1px solid ${color}33`,
              borderRadius: 10,
              padding: "12px 16px",
              display: "flex", alignItems: "center", gap: 12,
              minWidth: 160,
            }}
          >
            {/* Score circle */}
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              border: `2px solid ${color}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <span style={{
                fontFamily: "'Barlow Condensed',sans-serif",
                fontSize: 16, fontWeight: 700, color,
              }}>
                {h.overall_score}
              </span>
            </div>

            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: C.white,
                marginBottom: 3,
              }}>
                {h.team}
              </div>
              <div style={{
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {trend.icon}
                <span style={{ fontSize: 10, color: trend.color, fontWeight: 600 }}>
                  {trend.label}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
