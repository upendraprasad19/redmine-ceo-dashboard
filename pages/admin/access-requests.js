// Admin page: review self-service access requests.
// Lists pending/approved/rejected/resolved rows, lets admins approve or
// reject each pending request, and offers a single-shot Redmine sync
// button when the backing endpoint exists.
//
// Phase 7b. Style cloned from pages/login.js / pages/register.js.
import { useEffect, useMemo, useState } from 'react';
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

const FILTERS = ['pending', 'approved', 'rejected', 'resolved', 'all'];

const STATUS_STYLES = {
  pending:  { bg: 'rgba(201,124,26,0.15)',  color: C.amber, label: 'Pending' },
  approved: { bg: 'rgba(26,110,245,0.15)',  color: C.blue,  label: 'Approved' },
  rejected: { bg: 'rgba(224,62,62,0.15)',   color: C.red,   label: 'Rejected' },
  resolved: { bg: 'rgba(46,204,113,0.15)',  color: C.green, label: 'Resolved' },
};

function truncate(s, n) {
  if (!s) return '';
  const t = String(s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function AccessRequestsPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [filter, setFilter] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actioning, setActioning] = useState(null); // id being acted on
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  // Auth guard — redirect to /login on 401, to / on non-admin.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me');
        if (cancelled) return;
        if (r.status === 401) { router.replace('/login'); return; }
        if (!r.ok) { router.replace('/'); return; }
        const me = await r.json();
        if (me.role !== 'manager') { router.replace('/'); return; }
        setAuthChecked(true);
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  // Load requests whenever the filter changes (after auth passes).
  useEffect(() => {
    if (!authChecked) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/admin/access-requests?status=${filter}`);
        const body = await r.json();
        if (cancelled) return;
        if (r.ok) {
          setRequests(body.requests || []);
        } else {
          setError(body.error || body.message || 'Failed to load requests');
        }
      } catch {
        if (!cancelled) setError('Network error loading requests');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authChecked, filter]);

  const counts = useMemo(() => ({ total: requests.length }), [requests]);

  async function doAction(row, action) {
    const verb = action === 'approve' ? 'Approve' : 'Reject';
    if (!window.confirm(`${verb} request from ${row.full_name}?`)) return;
    setActioning(row.id);
    setError(null);
    try {
      const r = await fetch(`/api/admin/access-requests/${row.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await r.json();
      if (!r.ok) {
        setError(body.message || body.error || `Failed to ${action}`);
      } else {
        // Refresh the list to pick up the new status/reviewer info.
        const rr = await fetch(`/api/admin/access-requests?status=${filter}`);
        if (rr.ok) {
          const bb = await rr.json();
          setRequests(bb.requests || []);
        }
      }
    } catch {
      setError(`Network error during ${action}`);
    } finally {
      setActioning(null);
    }
  }

  async function runSync() {
    if (!window.confirm('Run a Redmine sync now? Approved requests will be matched and emailed their one-click link.')) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch('/api/sync', { method: 'POST' });
      if (r.ok) {
        setSyncMsg('Sync completed.');
        const rr = await fetch(`/api/admin/access-requests?status=${filter}`);
        if (rr.ok) {
          const bb = await rr.json();
          setRequests(bb.requests || []);
        }
      } else {
        setSyncMsg('Sync failed. Check server logs.');
      }
    } catch {
      setSyncMsg('Network error triggering sync.');
    } finally {
      setSyncing(false);
    }
  }

  // Styles
  const pageWrap = {
    fontFamily: "'Barlow', sans-serif", background: C.bg, minHeight: '100vh',
    color: C.white, padding: '30px 24px',
  };
  const container = { maxWidth: 1080, margin: '0 auto' };
  const headerTitle = {
    fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, fontWeight: 700,
    color: C.white, marginBottom: 4,
  };
  const headerSub = { fontSize: 12, color: C.dim, marginBottom: 18, lineHeight: 1.5 };
  const chip = (active) => ({
    padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 999,
    border: `1px solid ${active ? C.blue : C.borderHi}`,
    background: active ? 'rgba(26,110,245,0.18)' : 'transparent',
    color: active ? C.white : C.dim,
    cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.03em',
    textTransform: 'capitalize',
  });
  const btn = (enabled) => ({
    background: enabled ? C.blue : 'rgba(26,110,245,0.35)', border: 'none',
    borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600,
    color: C.white, cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit',
  });
  const dangerBtn = (enabled) => ({
    background: enabled ? 'rgba(224,62,62,0.14)' : 'rgba(224,62,62,0.06)',
    border: `1px solid ${enabled ? '#E03E3E66' : '#E03E3E22'}`,
    color: C.red, borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
  });
  const subtleBtn = {
    background: 'none', border: `1px solid ${C.borderHi}`, color: C.dim,
    borderRadius: 8, padding: '8px 14px', fontSize: 12, cursor: 'pointer',
    fontFamily: 'inherit',
  };

  if (!authChecked) {
    return (
      <div style={{ ...pageWrap, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.dim, fontSize: 13 }}>Checking access…</div>
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <div style={container}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={headerTitle}>Access Requests</div>
            <div style={headerSub}>
              Approvals don't grant access immediately. After you approve, create the user in Redmine,
              then run the sync — the email is sent when the sync links them up.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <button
              style={btn(!syncing)}
              onClick={runSync}
              disabled={syncing}
              title="Triggers /api/sync to match approved requests and mail one-click links."
            >
              {syncing ? 'Syncing…' : 'Run Redmine sync now'}
            </button>
            {syncMsg && (
              <div style={{ fontSize: 11, color: C.dim }}>{syncMsg}</div>
            )}
          </div>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0 14px' }}>
          {FILTERS.map(f => (
            <button key={f} style={chip(filter === f)} onClick={() => setFilter(f)}>{f}</button>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 11, color: C.dimmer, alignSelf: 'center' }}>
            {loading ? 'Loading…' : `${counts.total} shown`}
          </div>
        </div>

        {error && (
          <div style={{
            background: '#E03E3E12', border: '1px solid #E03E3E44',
            borderRadius: 8, padding: '10px 14px',
            fontSize: 12, color: C.red, marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        {/* List */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.card, overflow: 'hidden' }}>
          {!loading && requests.length === 0 && (
            <div style={{ padding: 24, color: C.dim, fontSize: 13, textAlign: 'center' }}>
              No {filter === 'all' ? '' : filter} requests.
            </div>
          )}
          {requests.map(r => (
            <AccessRequestRow
              key={r.id}
              row={r}
              busy={actioning === r.id}
              onApprove={() => doAction(r, 'approve')}
              onReject={() => doAction(r, 'reject')}
              btn={btn}
              dangerBtn={dangerBtn}
              subtleBtn={subtleBtn}
            />
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <a href="/" style={{ fontSize: 11, color: C.dim, textDecoration: 'none' }}>← Back to dashboard</a>
        </div>
      </div>
    </div>
  );
}

function AccessRequestRow({ row, busy, onApprove, onReject, btn, dangerBtn }) {
  const statusStyle = STATUS_STYLES[row.status] || { bg: 'rgba(255,255,255,0.05)', color: C.dim, label: row.status };
  const isPending = row.status === 'pending';
  const isResolved = row.status === 'resolved' || row.status === 'approved' || row.status === 'rejected';

  return (
    <div style={{
      padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
      display: 'grid', gridTemplateColumns: '1fr auto', gap: 14,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.white }}>{row.full_name}</span>
          <span style={{ fontSize: 11, color: C.dim }}>{row.email}</span>
          {row.team && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 6,
              background: 'rgba(255,255,255,0.05)', color: C.dim,
              border: `1px solid ${C.border}`,
            }}>{row.team}</span>
          )}
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 6,
            background: statusStyle.bg, color: statusStyle.color, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{statusStyle.label}</span>
        </div>
        {row.message && (
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 4, lineHeight: 1.4 }}>
            {truncate(row.message, 80)}
          </div>
        )}
        <div style={{ fontSize: 10, color: C.dimmer }}>
          Submitted {formatWhen(row.created_at)}
          {isResolved && row.reviewed_by_name && (
            <>  ·  Reviewed by <span style={{ color: C.dim }}>{row.reviewed_by_name}</span>{row.reviewed_at ? ` ${formatWhen(row.reviewed_at)}` : ''}</>
          )}
        </div>
      </div>
      {isPending && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={btn(!busy)} onClick={onApprove} disabled={busy}>
            {busy ? '…' : 'Approve'}
          </button>
          <button style={dangerBtn(!busy)} onClick={onReject} disabled={busy}>Reject</button>
        </div>
      )}
    </div>
  );
}
