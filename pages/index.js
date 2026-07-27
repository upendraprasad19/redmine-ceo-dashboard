import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import Dashboard from '../components/Dashboard'

export default function Home() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  async function fetchUser() {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const user = await res.json()
        setCurrentUser(user)
      } else {
        // If not authenticated, redirect to login
        router.push('/login')
      }
    } catch (e) {
      console.error('Failed to fetch user:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout')
    router.push('/login')
  }

  if (loading) {
    return (
      <div
        style={{
          fontFamily: "'Barlow', sans-serif",
          background: '#030B15',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: '3px solid rgba(26,110,245,0.15)',
              borderTopColor: '#1A6EF5',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
          <div style={{ fontSize: 13, color: '#1A6EF5', fontWeight: 600 }}>Loading...</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return <Dashboard onLogout={handleLogout} currentUser={currentUser} />
}
