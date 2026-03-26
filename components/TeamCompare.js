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

function CompareBar({ label, valA, valB, maxVal, colorA, colorB }) {
  const maxDisplay = maxVal || Math.max(valA, valB, 1);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 9, letterSpacing: "0.12em", color: C.dimmer,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {/* Team A bar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
            <span style={{
              fontFamily: "'Barlow Condensed',sans-serif",
              fontSize: 18, fontWeight: 700, color: colorA,
            }}>
              {typeof valA === "number" ? valA : valA}
            </span>
          </div>
          <div style={{
            background: "rgba(255,255,255,0.07)", borderRadius: 99, height: 6,
            overflow: "hidden", direction: "rtl",
          }}>
            <div style={{
              width: `${Math.min((valA / maxDisplay) * 100, 100)}%`,
              height: "100%", background: colorA, borderRadius: 99,
              transition: "width .6s ease",
            }}/>
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 30, background: C.border, flexShrink: 0 }}/>

        {/* Team B bar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 8 }}>
            <span style={{
              fontFamily: "'Barlow Condensed',sans-serif",
              fontSize: 18, fontWeight: 700, color: colorB,
            }}>
              {typeof valB === "number" ? valB : valB}
            </span>
          </div>
          <div style={{
            background: "rgba(255,255,255,0.07)", borderRadius: 99, height: 6,
            overflow: "hidden",
          }}>
            <div style={{
              width: `${Math.min((valB / maxDisplay) * 100, 100)}%`,
              height: "100%", background: colorB, borderRadius: 99,
              transition: "width .6s ease",
            }}/>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TeamCompare({ teams = [], people = [], tickets = [], timeLogs = [] }) {
  const teamNames = [...new Set([
    ...people.map(p => p.team),
    ...teams.map(t => t.team),
  ])].filter(Boolean).sort();

  const [teamA, setTeamA] = useState(teamNames[0] || "");
  const [teamB, setTeamB] = useState(teamNames[1] || teamNames[0] || "");
  const [healthData, setHealthData] = useState([]);

  useEffect(() => {
    fetchHealth();
  }, []);

  async function fetchHealth() {
    try {
      const res = await fetch("/api/team-health");
      if (res.ok) {
        const data = await res.json();
        setHealthData(data.health || []);
      }
    } catch (e) {
      // Health data is optional
    }
  }

  function getTeamStats(teamName) {
    const teamPeople = people.filter(p => p.team === teamName);
    const teamTickets = tickets.filter(t => t.team === teamName);
    const teamLogs = timeLogs.filter(t => t.team === teamName);
    const healthEntry = healthData.find(h => h.team === teamName);
    const workloadEntry = teams.find(t => t.team === teamName);

    const overdue = teamTickets.filter(t => t.overdue).length;
    const totalHours = teamLogs.reduce((s, l) => s + parseFloat(l.hours || l.h || 0), 0);
    const avgHours = teamPeople.length > 0 ? Math.round((totalHours / teamPeople.length) * 10) / 10 : 0;

    return {
      members: teamPeople.length,
      openTickets: teamTickets.length,
      overdue,
      avgHours,
      healthScore: healthEntry?.overall_score || 0,
      avgTicketsPerPerson: workloadEntry?.avg_tickets_per_person || (teamPeople.length > 0 ? Math.round(teamTickets.length / teamPeople.length) : 0),
    };
  }

  if (teamNames.length < 2) return null;

  const statsA = getTeamStats(teamA);
  const statsB = getTeamStats(teamB);

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "20px 22px",
    }}>
      <div style={{
        fontSize: 10, letterSpacing: "0.12em", color: C.dimmer,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 20,
      }}>
        Team Comparison
      </div>

      {/* Team selectors */}
      <div style={{
        display: "flex", gap: 16, marginBottom: 24, alignItems: "center",
      }}>
        <div style={{ flex: 1 }}>
          <select
            value={teamA}
            onChange={e => setTeamA(e.target.value)}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 8,
              background: C.bg, color: C.blueLight,
              border: `1px solid ${C.blue}44`,
              outline: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 13,
              fontFamily: "'Barlow', sans-serif",
            }}
          >
            {teamNames.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div style={{
          fontSize: 11, color: C.dimmer, fontWeight: 700,
          letterSpacing: "0.1em", flexShrink: 0,
        }}>
          VS
        </div>

        <div style={{ flex: 1 }}>
          <select
            value={teamB}
            onChange={e => setTeamB(e.target.value)}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 8,
              background: C.bg, color: C.green,
              border: `1px solid ${C.green}44`,
              outline: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 13,
              fontFamily: "'Barlow', sans-serif",
            }}
          >
            {teamNames.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Team name headers */}
      <div style={{
        display: "flex", gap: 12, marginBottom: 20, alignItems: "center",
      }}>
        <div style={{
          flex: 1, textAlign: "right",
          fontFamily: "'Barlow Condensed',sans-serif",
          fontSize: 16, fontWeight: 700, color: C.blueLight,
        }}>
          {teamA}
        </div>
        <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0 }}/>
        <div style={{
          flex: 1, textAlign: "left",
          fontFamily: "'Barlow Condensed',sans-serif",
          fontSize: 16, fontWeight: 700, color: C.green,
        }}>
          {teamB}
        </div>
      </div>

      {/* Comparison bars */}
      <CompareBar
        label="Open Tickets"
        valA={statsA.openTickets} valB={statsB.openTickets}
        colorA={C.blueLight} colorB={C.green}
      />
      <CompareBar
        label="Overdue"
        valA={statsA.overdue} valB={statsB.overdue}
        colorA={statsA.overdue > 0 ? C.red : C.blueLight}
        colorB={statsB.overdue > 0 ? C.red : C.green}
      />
      <CompareBar
        label="Avg Hours/Person"
        valA={statsA.avgHours} valB={statsB.avgHours}
        colorA={C.blueLight} colorB={C.green}
      />
      <CompareBar
        label="Health Score"
        valA={statsA.healthScore} valB={statsB.healthScore}
        maxVal={100}
        colorA={C.blueLight} colorB={C.green}
      />
      <CompareBar
        label="Members"
        valA={statsA.members} valB={statsB.members}
        colorA={C.blueLight} colorB={C.green}
      />
    </div>
  );
}
