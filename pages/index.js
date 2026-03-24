import { useRouter } from 'next/router';
import { useState } from 'react';

// ── paste your full ceo-desktop.jsx component tree here ──
// For now this is the shell with logout wired in.
// The full dashboard component will be imported below.

import Dashboard from '../components/Dashboard';

export default function Home() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout');
    router.push('/login');
  }

  return <Dashboard onLogout={handleLogout} />;
}
