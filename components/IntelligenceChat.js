import { useCallback, useEffect, useRef, useState } from 'react'

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

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 0' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: C.dim,
            animation: `typingDot 1.2s ease infinite ${i * 0.2}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes typingDot {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-4px); }
        }
      `}</style>
    </div>
  )
}

function formatMessage(text) {
  if (!text) return null

  // Replace TK-{number} with clickable links
  const parts = text.split(/(TK-\d+)/g)
  return parts.map((part, i) => {
    const match = part.match(/^TK-(\d+)$/)
    if (match) {
      return (
        <a
          key={i}
          href={`https://redmine.thinkingcode.com/issues/${match[1]}`}
          target="_blank"
          rel="noreferrer"
          style={{ color: C.blueLight, textDecoration: 'none', fontWeight: 600 }}
        >
          {part}
        </a>
      )
    }
    // Handle bold (**text**)
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g)
    return boldParts.map((bp, j) => {
      if (bp.startsWith('**') && bp.endsWith('**')) {
        return (
          <strong key={`${i}-${j}`} style={{ color: C.white }}>
            {bp.slice(2, -2)}
          </strong>
        )
      }
      return <span key={`${i}-${j}`}>{bp}</span>
    })
  })
}

export default function IntelligenceChat({ currentUser }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [people, setPeople] = useState([])
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const inputRef = useRef(null)

  // Load chat history on mount
  useEffect(() => {
    loadHistory(1)
    fetchPeople()
  }, [loadHistory, fetchPeople])

  async function fetchPeople() {
    try {
      const res = await fetch('/api/people')
      if (res.ok) {
        const data = await res.json()
        setPeople(data.people || [])
      }
    } catch (e) {
      console.error('Failed to fetch people:', e)
    }
  }

  async function loadHistory(p) {
    try {
      setLoadingHistory(true)
      const res = await fetch(`/api/chat-history?page=${p}&limit=50`)
      if (res.ok) {
        const data = await res.json()
        if (p === 1) {
          setMessages(data.messages || [])
        } else {
          setMessages((prev) => [...(data.messages || []), ...prev])
        }
        setPage(p)
        setHasMore(p < (data.pagination?.pages || 1))
      }
    } catch (e) {
      console.error('Failed to load chat history:', e)
    } finally {
      setLoadingHistory(false)
    }
  }

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [])

  // Handle scroll-to-top for loading more history
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    if (container.scrollTop < 50 && hasMore && !loadingHistory) {
      const prevHeight = container.scrollHeight
      loadHistory(page + 1).then(() => {
        // Preserve scroll position
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight - prevHeight
        })
      })
    }
  }, [hasMore, loadingHistory, page, loadHistory])

  // Handle @ mentions
  function handleInputChange(e) {
    const val = e.target.value
    setInput(val)

    // Check for @ trigger
    const lastAt = val.lastIndexOf('@')
    if (lastAt >= 0) {
      const afterAt = val.substring(lastAt + 1)
      // Only show dropdown if there's no space after @
      if (!afterAt.includes(' ') && afterAt.length <= 20) {
        setShowMentions(true)
        setMentionFilter(afterAt.toLowerCase())
        return
      }
    }
    setShowMentions(false)
  }

  function handleMentionSelect(person) {
    const lastAt = input.lastIndexOf('@')
    const newInput = `${input.substring(0, lastAt)}@${person.name} `
    setInput(newInput)
    setShowMentions(false)
    inputRef.current?.focus()
  }

  const filteredPeople = people
    .filter((p) => p.name.toLowerCase().includes(mentionFilter))
    .slice(0, 8)

  async function handleSend() {
    if (!input.trim() || sending) return

    const userMessage = input.trim()
    setInput('')
    setShowMentions(false)

    // Optimistically add user message
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userMessage, created_at: new Date().toISOString() },
    ])
    setSending(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      })

      if (res.ok) {
        const data = await res.json()
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.message, created_at: new Date().toISOString() },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.',
            created_at: new Date().toISOString(),
          },
        ])
      }
    } catch (_e) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Network error. Please check your connection and try again.',
          created_at: new Date().toISOString(),
        },
      ])
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const greeting = currentUser?.display_name ? `Hello, ${currentUser.display_name}` : 'Hello'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 140px)',
        animation: 'fadeIn .4s ease',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 0',
          marginBottom: 16,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'Barlow Condensed',sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: C.white,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <svg
              width="20"
              height="20"
              fill="none"
              stroke={C.blue}
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <path d="M12 2a7 7 0 0 1 7 7v1a7 7 0 0 1-14 0V9a7 7 0 0 1 7-7z" />
              <path d="M8 21h8M12 17v4" />
              <circle cx="12" cy="9" r="1" fill={C.blue} />
            </svg>
            Intelligence
          </div>
          <div style={{ fontSize: 12, color: C.dimmer, marginTop: 4 }}>
            {greeting} -- Ask me about tickets, team status, or project health.
          </div>
        </div>
        <div
          style={{
            background: `${C.blue}18`,
            border: `1px solid ${C.blue}44`,
            borderRadius: 8,
            padding: '6px 14px',
            fontSize: 11,
            color: C.blueLight,
            fontWeight: 600,
          }}
        >
          AI Assistant
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '8px 0',
          minHeight: 0,
        }}
      >
        {/* Load more indicator */}
        {loadingHistory && (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <div
              style={{
                width: 24,
                height: 24,
                border: `2px solid ${C.blue}22`,
                borderTopColor: C.blue,
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto',
              }}
            />
          </div>
        )}

        {/* Empty state */}
        {!loadingHistory && messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(26,110,245,0.2), rgba(26,110,245,0.05))',
                border: `1px solid ${C.blue}33`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                width="28"
                height="28"
                fill="none"
                stroke={C.blue}
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.white, marginBottom: 6 }}>
                Start a Conversation
              </div>
              <div style={{ fontSize: 12, color: C.dimmer, lineHeight: 1.6, maxWidth: 320 }}>
                Ask about overdue tickets, team workload, project deadlines, or anyone's status. Use
                @name to mention team members.
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                justifyContent: 'center',
                marginTop: 8,
              }}
            >
              {[
                'Who has overdue tickets?',
                'Team workload summary',
                'Project deadline risks',
                "Who hasn't logged time today?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion)
                    inputRef.current?.focus()
                  }}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: '8px 14px',
                    fontSize: 12,
                    color: C.dim,
                    cursor: 'pointer',
                    transition: 'all .15s',
                    fontFamily: "'Barlow', sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = C.borderHi
                    e.currentTarget.style.color = C.white
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = C.border
                    e.currentTarget.style.color = C.dim
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '75%',
                padding: '12px 16px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.role === 'user' ? C.blue : C.card,
                border: msg.role === 'user' ? 'none' : `1px solid ${C.border}`,
                fontSize: 13,
                lineHeight: 1.7,
                color: msg.role === 'user' ? C.white : C.dim,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {msg.role === 'user' ? msg.content : formatMessage(msg.content)}
              <div
                style={{
                  fontSize: 9,
                  color: msg.role === 'user' ? 'rgba(255,255,255,0.5)' : C.dimmer,
                  marginTop: 6,
                  textAlign: msg.role === 'user' ? 'right' : 'left',
                }}
              >
                {msg.created_at
                  ? new Date(msg.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {sending && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '16px 16px 16px 4px',
                background: C.card,
                border: `1px solid ${C.border}`,
              }}
            >
              <TypingIndicator />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* @mention dropdown */}
      {showMentions && filteredPeople.length > 0 && (
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.borderHi}`,
            borderRadius: 10,
            padding: '4px 0',
            maxHeight: 200,
            overflowY: 'auto',
            marginBottom: 4,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
          }}
        >
          {filteredPeople.map((p) => (
            <div
              key={p.id}
              onClick={() => handleMentionSelect(p)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px',
                cursor: 'pointer',
                transition: 'background .12s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#0c1a2e')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.blueLight,
                  fontFamily: "'Barlow Condensed',sans-serif",
                }}
              >
                {p.initials ||
                  p.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.white }}>{p.name}</div>
                <div style={{ fontSize: 10, color: C.dimmer }}>
                  {p.team} · {p.role}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 0',
          borderTop: `1px solid ${C.border}`,
          marginTop: 8,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask about tickets, team status, projects..."
          disabled={sending}
          style={{
            flex: 1,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: 13,
            color: C.white,
            outline: 'none',
            fontFamily: "'Barlow', sans-serif",
            transition: 'border-color .15s',
          }}
          onFocus={(e) => (e.target.style.borderColor = C.blue)}
          onBlur={(e) => (e.target.style.borderColor = C.border)}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: !input.trim() || sending ? C.card : C.blue,
            border: `1px solid ${!input.trim() || sending ? C.border : C.blue}`,
            color: C.white,
            cursor: !input.trim() || sending ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all .15s',
            flexShrink: 0,
          }}
        >
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
