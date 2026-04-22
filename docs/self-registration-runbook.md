# Self-Registration — Deployment Runbook

Feature branch: `feature/self-registration` → 19 commits ready to merge.

This runbook covers the manual steps that have to happen between merge and the first user successfully registering in production.

## 1. Database migrations (in order)

Apply against both dev (Neon preview) and production Neon DBs:

```
scripts/migrations/020-add-developer-role.sql
scripts/migrations/021-registration.sql
scripts/migrations/022-dashboard-users-email.sql
```

`022` formalizes the `dashboard_users.email` column that was added manually earlier — idempotent, safe to apply even if the column already exists.

Run via whatever mechanism the project already uses (check `scripts/migrate.js` or `package.json` scripts). Spot-check afterward:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'pending_registrations' ORDER BY ordinal_position;
-- Expect: id, code, linked_redmine_user_id, username, password_hash, email,
--   email_verified, email_otp, email_otp_expires_at, email_otp_attempts,
--   telegram_id, telegram_verified_at, verified_channel, status, expires_at,
--   created_at

\d pending_registrations      -- verify partial unique indexes on LOWER(email) and linked_redmine_user_id
                              -- where status = 'awaiting_verification'

\d dashboard_users            -- verify role CHECK allows 'developer' and email column present
```

## 2. Environment variables

Add these to **both** `.env.local` (for dev) and Vercel (Settings → Environment Variables) for production:

| Var | Value | Notes |
|---|---|---|
| `MANAGER_USERNAMES` | `anu,upendra,prashant,pradeep` | Comma-separated usernames that will be resolved to `manager` role. Case-insensitive match. |
| `RESEND_API_KEY` | `re_xxx...` | Create a Resend account, verify the `thinkingcode.in` domain, issue an API key. |
| `EMAIL_FROM` | `noreply@thinkingcode.in` | Must be on a domain verified in Resend. |
| `PUBLIC_BASE_URL` | `https://<your-vercel-host>` | Used to build one-click approval links in emails and the "Review" link in Upendra's Telegram DMs. Without it, emails contain relative paths that won't work from an inbox. |
| `UPENDRA_TELEGRAM_ID` | `8674834540` | Already has a hardcoded default; override only if the chat ID ever rotates. |
| `JWT_SECRET` | (existing) | Reused for finalize_token + approval req_token signing. No change needed if already set. |

## 3. Resend setup checklist

1. Create account at resend.com.
2. Add `thinkingcode.in` (or whatever domain `EMAIL_FROM` lives on) — add the DNS records they give you (SPF + DKIM + DMARC).
3. Wait for domain verification to complete (usually <10 min).
4. Create an API key. Paste into `RESEND_API_KEY`.
5. Quick test: from local with the key set, run `node -e "require('./lib/email').sendOtp('your-personal@email.com','123456').then(console.log).catch(console.error)"`. You should receive a test email.

## 4. Vercel deploy

Push is already done. From the Vercel dashboard:
1. Verify env vars from step 2 are set for both Preview and Production.
2. Trigger a Preview deploy of the branch (or let Vercel auto-deploy).
3. Smoke-test the preview URL before merging to `master`.

## 5. Smoke tests (run on the preview URL)

### Happy path — Telegram channel
1. Open `/register` → dropdown shows unregistered Redmine users.
2. Pick an unregistered name (create a throwaway Redmine user for this if needed).
3. Confirm identity, set username + password.
4. Choose **Verify via Telegram**. The page shows `/verify <32-hex>` with a Copy button.
5. From a Telegram account that has never used `@ThinkingCodeBot` before, send that exact `/verify <code>` command.
6. The bot replies `✅ Telegram verified. Return to the registration page to finish.`
7. The wizard auto-finishes and redirects to `/`. You should be logged in.

### Happy path — Email channel
1. Same start, but at Step 4 choose **Verify via Email**.
2. OTP email arrives within seconds.
3. Enter code → auto-finalize → `/`.

### Channel switch
1. Start email flow, don't enter OTP, click **← Use Telegram instead**.
2. Switch completes, Telegram path works.

### Unlisted path
1. `/register` → click *My name isn't listed*.
2. Fill the form with a name that doesn't match any Redmine user.
3. Submit → confirmation screen.
4. Upendra's Telegram receives a DM.
5. Open `/admin/access-requests` → the row is there. Click Approve.
6. Manually add that user to Redmine (or insert into `users` table).
7. Click **Run Redmine sync now** from the admin page.
8. The user should receive an email with a 7-day one-click link `{BASE}/register?req=<token>`.
9. Clicking it lands them at Step 2 of the wizard with their identity pre-filled and locked.
10. Completing registration produces a normal `dashboard_users` row.

### Rejection
1. Submit an access request, reject from admin.
2. User receives the rejection email (short, no reason).

### Edge cases worth clicking through
- Incorrect OTP 5 times → row is expired, page nudges to start over.
- Wait 30 minutes mid-wizard → session expiry copy appears.
- Enter a `javascript:` link via hand-crafted form submission → rejected by `requireHttpUrl` in email module (pre-shipment, shouldn't happen in UI).
- Try to register two different codes from the same Telegram account → bot rejects.

## 6. Role verification

Log in as each role and confirm:

- **Manager** (any username in `MANAGER_USERNAMES` or promoted manually): unchanged, sees everything.
- **Team lead** (`is_team_lead=true` on users row): unchanged.
- **Developer** (new, self-registered, not in manager list, not team lead): sees only own data. Admin nav hidden, People nav hidden, Executive Snapshot block hidden, Team Health hidden, Escalation Chain hidden.

## 7. Ops — monitoring after launch

- Watch `pending_registrations` table in the first week: any rows stuck in `awaiting_verification` past `expires_at` are users who bailed mid-flow. Harmless, but high volume means UX friction somewhere.
- Watch `access_requests` table: Upendra's review cadence. If a row sits `approved` but never `resolved`, it means Redmine-user creation was skipped — schedule a sync or do it manually.
- `register_rate_limit` table grows unbounded — add a cleanup cron if it starts mattering. Not urgent; rows are ~100 bytes each.
- Check Vercel logs for any 5xx from `/api/auth/register/*`.

## 8. Rollback plan

If something goes badly wrong in production:

1. Revert the deploy in Vercel (instant).
2. The schema changes are additive — safe to leave in place even on rollback (migrations 020/021/022 don't break anything if unused).
3. No existing data is modified by these migrations; only new tables are created. Dropping them (if truly necessary) is safe:
   ```sql
   DROP TABLE pending_registrations CASCADE;
   DROP TABLE access_requests CASCADE;
   DROP TABLE register_rate_limit;
   -- Leave 020 and 022 in place; they extend existing tables in a backwards-compatible way.
   ```

## 9. Known follow-ups (deferred — separate plans)

- Password reset using the verified channel (email or Telegram).
- Auto-deactivate `dashboard_users.active=false` when the linked Redmine user goes inactive.
- Post-login "Connect your other channel" nudge for users who only verified one of Telegram/email.
- Polished developer-role dashboard (currently just hides manager widgets; full dev-focused layout is its own project).
- Replace `MANAGER_USERNAMES` env var with a `users.is_manager` column sourced from Redmine groups once Redmine modeling is clearer.
- Refactor `components/Dashboard.js` (2181-line monolith) into per-screen components.
