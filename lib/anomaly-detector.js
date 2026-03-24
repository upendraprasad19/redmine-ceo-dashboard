/**
 * lib/anomaly-detector.js
 *
 * Detects operational anomalies from current DB state and fires alerts.
 * Deduplicates via anomaly_alerts table (ON CONFLICT DO NOTHING).
 * Also resolves alerts when the condition clears.
 *
 * Usage:
 *   import { detectAnomalies } from '../lib/anomaly-detector.js';
 *   const result = await detectAnomalies(sql, async (message, severity) => { ... });
 *   // result: { checked: N, fired: N, resolved: N }
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

/**
 * Returns the N most recent working days (Mon–Fri) before today (not including today).
 * Returns an array of ISO date strings.
 */
function lastNWorkingDays(n) {
  const days = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (days.length < n) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) {
      days.push(d.toISOString().split('T')[0]);
    }
  }
  return days;
}

/**
 * Try to insert a new alert. Returns true if it was new (rows inserted > 0).
 */
async function tryInsertAlert(sql, { alertType, entityType, entityId, message, severity }) {
  const rows = await sql`
    INSERT INTO anomaly_alerts (alert_type, entity_type, entity_id, message, severity, sent_at)
    VALUES (${alertType}, ${entityType}, ${entityId}, ${message}, ${severity}, NOW())
    ON CONFLICT (alert_type, entity_id, entity_type) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function detectAnomalies(sql, sendTelegramFn) {
  let checked = 0;
  let fired = 0;
  let resolved = 0;

  const today = new Date().toISOString().split('T')[0];
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const dow = todayDate.getDay(); // 0=Sun, 6=Sat
  const isWeekday = dow !== 0 && dow !== 6;

  // ── 1. BURNOUT ─────────────────────────────────────────────────────────────
  // User with >15 open tickets AND logged <4h in last 3 working days
  try {
    const last3Days = lastNWorkingDays(3);

    const burnoutUsers = await sql`
      SELECT
        u.id,
        u.name,
        u.team,
        COUNT(i.id) AS open_count,
        COALESCE(SUM(te.hours), 0) AS hours_logged
      FROM users u
      JOIN issues i
        ON i.assigned_to_id = u.id
        AND i.status NOT IN ('Closed', 'Resolved')
      LEFT JOIN time_entries te
        ON te.user_id = u.id
        AND te.spent_on = ANY(${last3Days}::date[])
      WHERE u.active = true
      GROUP BY u.id, u.name, u.team
      HAVING COUNT(i.id) > 15
         AND COALESCE(SUM(te.hours), 0) < 4
    `;

    checked += burnoutUsers.length;

    for (const user of burnoutUsers) {
      const message = `⚠️ Burnout risk: ${user.name} has ${user.open_count} open tickets and only ${parseFloat(user.hours_logged).toFixed(1)}h logged in last 3 days`;
      const isNew = await tryInsertAlert(sql, {
        alertType: 'burnout',
        entityType: 'user',
        entityId: user.id,
        message,
        severity: 'warning',
      });
      if (isNew) {
        console.log(`[anomaly] NEW burnout alert: ${message}`);
        await sendTelegramFn(message, 'warning').catch(e => console.error('[anomaly] Telegram error:', e.message));
        fired++;
      }
    }

    // Resolve burnout alerts where user now has <=15 tickets OR has logged enough hours
    const resolvedBurnout = await sql`
      UPDATE anomaly_alerts
      SET resolved_at = NOW()
      WHERE alert_type = 'burnout'
        AND entity_type = 'user'
        AND resolved_at IS NULL
        AND entity_id NOT IN (
          SELECT u.id
          FROM users u
          JOIN issues i
            ON i.assigned_to_id = u.id
            AND i.status NOT IN ('Closed', 'Resolved')
          LEFT JOIN time_entries te
            ON te.user_id = u.id
            AND te.spent_on = ANY(${last3Days}::date[])
          WHERE u.active = true
          GROUP BY u.id
          HAVING COUNT(i.id) > 15
             AND COALESCE(SUM(te.hours), 0) < 4
        )
    `;
    resolved += resolvedBurnout.count ?? 0;
  } catch (err) {
    console.error('[anomaly] Burnout check failed:', err.message);
  }

  // ── 2. BLOCKED_ROTTING ─────────────────────────────────────────────────────
  // Issue in 'Blocked' status for >3 days (updated_at < 3 days ago)
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const blockedIssues = await sql`
      SELECT
        i.id,
        i.id AS redmine_id,
        i.id AS title,
        i.updated_at,
        COALESCE(u.name, 'Unassigned') AS assigned_name,
        EXTRACT(DAY FROM NOW() - i.updated_at)::int AS days_blocked
      FROM issues i
      LEFT JOIN users u ON u.id = i.assigned_to_id
      WHERE i.status = 'Blocked'
        AND i.updated_at < ${threeDaysAgo}::timestamptz
    `;

    checked += blockedIssues.length;

    for (const issue of blockedIssues) {
      const days = issue.days_blocked ?? 3;
      const message = `🚧 Blocked for ${days}d: #${issue.redmine_id} ${issue.title} (assigned: ${issue.assigned_name})`;
      const isNew = await tryInsertAlert(sql, {
        alertType: 'blocked_rotting',
        entityType: 'issue',
        entityId: issue.id,
        message,
        severity: 'warning',
      });
      if (isNew) {
        console.log(`[anomaly] NEW blocked_rotting alert: ${message}`);
        await sendTelegramFn(message, 'warning').catch(e => console.error('[anomaly] Telegram error:', e.message));
        fired++;
      }
    }

    // Resolve blocked_rotting where issue is no longer blocked
    const resolvedBlocked = await sql`
      UPDATE anomaly_alerts
      SET resolved_at = NOW()
      WHERE alert_type = 'blocked_rotting'
        AND entity_type = 'issue'
        AND resolved_at IS NULL
        AND entity_id NOT IN (
          SELECT id FROM issues WHERE status = 'Blocked'
        )
    `;
    resolved += resolvedBlocked.count ?? 0;
  } catch (err) {
    console.error('[anomaly] Blocked rotting check failed:', err.message);
  }

  // ── 3. VELOCITY_DROP ───────────────────────────────────────────────────────
  // This week's closed tickets < 50% of last week's (only check Mon–Fri)
  if (isWeekday) {
    try {
      // Start of current week (Monday)
      const thisMonday = new Date(todayDate);
      thisMonday.setDate(todayDate.getDate() - (dow === 0 ? 6 : dow - 1));
      const thisMondayStr = thisMonday.toISOString().split('T')[0];

      // Start of last week (Monday)
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      const lastMondayStr = lastMonday.toISOString().split('T')[0];

      // End of last week (Friday)
      const lastFriday = new Date(thisMonday);
      lastFriday.setDate(thisMonday.getDate() - 3);
      const lastFridayStr = lastFriday.toISOString().split('T')[0];

      const [{ this_week }] = await sql`
        SELECT COUNT(*) AS this_week
        FROM issues
        WHERE closed_at::date >= ${thisMondayStr}::date
          AND closed_at::date <= ${today}::date
          AND status IN ('Closed', 'Resolved')
      `;

      const [{ last_week }] = await sql`
        SELECT COUNT(*) AS last_week
        FROM issues
        WHERE closed_at::date >= ${lastMondayStr}::date
          AND closed_at::date <= ${lastFridayStr}::date
          AND status IN ('Closed', 'Resolved')
      `;

      checked++;

      const thisWeekCount = parseInt(this_week, 10);
      const lastWeekCount = parseInt(last_week, 10);

      // Only fire if last week had meaningful activity and this week is below 50%
      if (lastWeekCount > 0 && thisWeekCount < lastWeekCount * 0.5) {
        const dropPercent = Math.round((1 - thisWeekCount / lastWeekCount) * 100);
        const severity = dropPercent > 70 ? 'critical' : 'warning';
        const message = `📉 Velocity drop: ${thisWeekCount} tickets closed this week vs ${lastWeekCount} last week`;

        const isNew = await tryInsertAlert(sql, {
          alertType: 'velocity_drop',
          entityType: 'global',
          entityId: 0,
          message,
          severity,
        });
        if (isNew) {
          console.log(`[anomaly] NEW velocity_drop alert: ${message}`);
          await sendTelegramFn(message, severity).catch(e => console.error('[anomaly] Telegram error:', e.message));
          fired++;
        }
      }
    } catch (err) {
      console.error('[anomaly] Velocity drop check failed:', err.message);
    }
  }

  // ── 4. GHOST_DEV ───────────────────────────────────────────────────────────
  // Active user with no time entry for 2 working days (Mon–Fri)
  if (isWeekday) {
    try {
      const last2Days = lastNWorkingDays(2);

      const ghostDevs = await sql`
        SELECT
          u.id,
          u.name,
          u.team
        FROM users u
        WHERE u.active = true
          AND NOT EXISTS (
            SELECT 1
            FROM time_entries te
            WHERE te.user_id = u.id
              AND te.spent_on = ANY(${last2Days}::date[])
          )
      `;

      checked += ghostDevs.length;

      for (const user of ghostDevs) {
        const message = `👻 No time logged: ${user.name} (${user.team || 'Unknown'}) - 2 working days without logging`;
        const isNew = await tryInsertAlert(sql, {
          alertType: 'ghost_dev',
          entityType: 'user',
          entityId: user.id,
          message,
          severity: 'warning',
        });
        if (isNew) {
          console.log(`[anomaly] NEW ghost_dev alert: ${message}`);
          await sendTelegramFn(message, 'warning').catch(e => console.error('[anomaly] Telegram error:', e.message));
          fired++;
        }
      }

      // Resolve ghost_dev where user has logged time recently
      const resolvedGhost = await sql`
        UPDATE anomaly_alerts
        SET resolved_at = NOW()
        WHERE alert_type = 'ghost_dev'
          AND entity_type = 'user'
          AND resolved_at IS NULL
          AND entity_id IN (
            SELECT DISTINCT user_id
            FROM time_entries
            WHERE spent_on = ANY(${last2Days}::date[])
          )
      `;
      resolved += resolvedGhost.count ?? 0;
    } catch (err) {
      console.error('[anomaly] Ghost dev check failed:', err.message);
    }
  }

  // ── 5. CRITICAL_UNASSIGNED ─────────────────────────────────────────────────
  // Critical/High issue unassigned and open for >4 hours
  try {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const unassigned = await sql`
      SELECT
        i.id,
        i.id AS redmine_id,
        i.id AS title,
        i.priority,
        i.updated_at
      FROM issues i
      WHERE i.priority IN ('Critical', 'High')
        AND i.assigned_to_id IS NULL
        AND i.status NOT IN ('Closed', 'Resolved')
        AND i.updated_at < ${fourHoursAgo}::timestamptz
    `;

    checked += unassigned.length;

    for (const issue of unassigned) {
      const message = `🔥 Unassigned critical: #${issue.redmine_id} ${issue.title}`;
      const isNew = await tryInsertAlert(sql, {
        alertType: 'critical_unassigned',
        entityType: 'issue',
        entityId: issue.id,
        message,
        severity: 'critical',
      });
      if (isNew) {
        console.log(`[anomaly] NEW critical_unassigned alert: ${message}`);
        await sendTelegramFn(message, 'critical').catch(e => console.error('[anomaly] Telegram error:', e.message));
        fired++;
      }
    }
  } catch (err) {
    console.error('[anomaly] Critical unassigned check failed:', err.message);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`[anomaly] Detection complete. checked=${checked}, fired=${fired}, resolved=${resolved}`);
  return { checked, fired, resolved };
}
