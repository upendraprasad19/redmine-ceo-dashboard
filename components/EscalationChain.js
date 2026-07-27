import { useEffect, useState } from 'react'

const C = {
  bg: '#030B15',
  surface: '#070F1C',
  card: '#0A1628',
  border: 'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.16)',
  blue: '#1A6EF5',
  blueLight: '#4B9BFF',
  white: '#F0F4FF',
  dim: 'rgba(240,244,255,0.45)',
  dimmer: 'rgba(240,244,255,0.22)',
  red: '#E03E3E',
  amber: '#C97C1A',
  green: '#1A9E6E',
}

export default function EscalationChain({ currentUser }) {
  const [escalations, setEscalations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchEscalations()
  }, [fetchEscalations])

  async function fetchEscalations() {
    try {
      const res = await fetch('/api/escalations')
      if (res.ok) {
        const data = await res.json()
        setEscalations(data.escalations || [])
      }
    } catch (e) {
      console.error('Failed to fetch escalations:', e)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '20px 22px',
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.12em',
            color: C.dimmer,
            textTransform: 'uppercase',
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          Escalation Chain
        </div>
        <div style={{ color: C.dimmer, fontSize: 12 }}>Loading...</div>
      </div>
    )
  }

  if (escalations.length === 0) return null

  function getStatusColor(esc) {
    if (esc.actioned === true) return C.green
    if (esc.actioned === false && esc.action_taken) return C.amber
    return C.red
  }

  function getStatusLabel(esc) {
    if (esc.actioned === true) return 'Resolved'
    if (esc.action_taken) return 'Pending'
    return 'Unactioned'
  }

  function formatTime(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now - d
    const diffH = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffH < 1) return 'Just now'
    if (diffH < 24) return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    return `${diffD}d ago`
  }

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '20px 22px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.12em',
            color: C.dimmer,
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          Escalation Chain
        </div>
        <div
          style={{
            fontSize: 11,
            color: C.dim,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: escalations.some((e) => !e.actioned) ? C.red : C.green,
              display: 'inline-block',
            }}
          />
          {escalations.filter((e) => !e.actioned).length} open
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {escalations.slice(0, 5).map((esc, i) => {
          const statusColor = getStatusColor(esc)
          const statusLabel = getStatusLabel(esc)

          return (
            <div
              key={esc.id || i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
              }}
            >
              {/* Raised by */}
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.white,
                  minWidth: 80,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {esc.raised_by_name || 'Unknown'}
              </div>

              {/* Arrow */}
              <svg
                width="16"
                height="16"
                fill="none"
                stroke={statusColor}
                strokeWidth="2"
                viewBox="0 0 24 24"
                style={{ flexShrink: 0 }}
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>

              {/* Escalated to */}
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.white,
                  minWidth: 80,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {esc.escalated_to_name || 'Unknown'}
              </div>

              {/* Reason */}
              <div
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: C.dim,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {esc.rule_triggered || ''}
              </div>

              {/* Status badge */}
              <div
                style={{
                  background: `${statusColor}18`,
                  border: `1px solid ${statusColor}44`,
                  borderRadius: 6,
                  padding: '3px 9px',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: statusColor,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {statusLabel}
                </span>
              </div>

              {/* Time */}
              <div
                style={{
                  fontSize: 10,
                  color: C.dimmer,
                  flexShrink: 0,
                  minWidth: 48,
                  textAlign: 'right',
                }}
              >
                {formatTime(esc.created_at)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
