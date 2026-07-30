# Audit Playbook — Redmine CEO Dashboard

## Purpose
Standardized audit procedure adapted from AVYA's L3 discipline methodology. Ensures consistent, thorough auditing across all code changes and system interactions.

## Audit Cadence
- **Per-batch**: After every 3+ task batch or major feature
- **Quarterly**: Full comprehensive audit
- **Pre-deploy**: Security + Data Integrity focus before major releases

## Audit Workflow

### 1. Preparation
1. Read `LENS_REGISTRY.md` — understand all 14 audit lenses
2. Read `docs/audit/sot-registry.yaml` — understand writer/reader contracts
3. Run gate scripts: `npm run audit:gates` (all must pass)
4. Review recent `git log --oneline -20` for change scope

### 2. Execution (Per Lens)
For each lens in `LENS_REGISTRY.md`:
1. Run the lens-specific checklist
2. Document findings with:
   - **ID**: Sequential (AUD-001, AUD-002, ...)
   - **Lens**: Which lens found it
   - **Severity**: P0 (critical) / P1 (high) / P2 (medium) / P3 (low)
   - **File:Line**: Exact location
   - **Description**: What's wrong
   - **Impact**: What could break
   - **Proposed Fix**: How to fix it
   - **Regression Test**: How to prevent recurrence
   - **Vault Pattern**: Reference if applicable (e.g., `[[api-error-sanitization]]`)

### 3. Findings Document
Create `docs/audit/YYYY-MM-DD-audit-findings.md` with:
```markdown
# Audit Findings — YYYY-MM-DD

## Summary
- Total findings: N
- P0: N | P1: N | P2: N | P3: N
- Lenses covered: 14/14

## Findings

### AUD-001 — [Lens Name] — P0
- **File**: `path/to/file.js:42`
- **Description**: What's wrong
- **Impact**: What could break
- **Proposed Fix**: How to fix
- **Regression Test**: Test to add
- **Vault Pattern**: `[[pattern-name]]` (if applicable)
```

### 4. Audit Closures
Create `docs/audit/closures/YYYY_MM_DD_audit_closures.yaml`:
```yaml
audit_date: YYYY-MM-DD
total_findings: N
closed_count: N

findings:
  - id: AUD-001
    terminal_state: closed_in_commit
    commit: abc1234
    summary: What was fixed

  - id: AUD-002
    terminal_state: upstream_blocked
    blocker: Description of blocker
    
  - id: AUD-003
    terminal_state: verified_clean
    evidence: Why this is not a real issue
```

**Terminal States** (no deferrals allowed):
- `closed_in_commit`: Fixed and verified in a commit
- `upstream_blocked`: Blocked on external dependency
- `blocked_on_user`: Requires user decision/action
- `verified_clean`: Investigation proved not a real issue

### 5. Post-Audit
1. Run gate scripts again — all must pass
2. Update `vault/INDEX.md` with new patterns/gotchas
3. Update `board/INDEX.md` if tasks were created
4. Run `skill self-learning` to extract knowledge

## Gate Scripts
Automated checks that enforce audit standards:
- `check-api-auth-required.js` — All API routes have auth
- `check-email-normalization.js` — No raw thinkingcode.com
- `check-engineering-filter.js` — Time-log whitelist enforced
- `check-approved-projects-sync.js` — Project IDs consistent
- `check-error-sanitization.js` — All routes use send500()
- `check-audit-readers-writers.js` — Reader/writer analysis
- `check-module-system.js` — CJS/ESM boundary respected
- `check-regression-tests.js` — Behavioral tests exist
- `check-constant-drift.js` — No duplicated constants
- `check-secrets-not-committed.js` — No .env.local in git

Run all: `npm run audit:gates`

## Severity Definitions
- **P0 (Critical)**: Security breach, data loss, auth bypass — fix immediately
- **P1 (High)**: Feature broken, sync failure, incorrect data — fix before next deploy
- **P2 (Medium)**: Degraded experience, edge case bug — fix within sprint
- **P3 (Low)**: Code quality, naming, minor improvement — fix when convenient
