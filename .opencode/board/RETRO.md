# Retro Process

Run a retro on a trigger: **every 5 done tasks** (whichever) **or monthly**,
whichever comes first.

## Trigger
- Count done tasks in `board/done/`. When the running total since the last
  retro reaches 5, run a retro. Reset the counter after.
- If a calendar month elapses with no retro, run one regardless.

## Steps
1. **Read**: `board/done/` (all completed tasks since last retro) + `vault/`
   (gotchas, patterns added in the window).
2. **Throughput**: count tasks done, by tier (T0/T1/T2) if recorded. Note
   median time-to-done if timestamps are available.
3. **Recurring signals**: tally gotcha tags / repeated mistakes. If the same
   tag (e.g. `#delivery-owner`, `#status-map`) shows up 2+ times, surface it
   as a **systemic signal**.
4. **Propose tweaks**: for each systemic signal, propose a concrete process or
   convention change — a new AGENTS.md line, a new hook, a new test, a checklist
   item. Keep proposals small and actionable.
5. **Write entry**: append a dated section below (## YYYY-MM-DD) with throughput,
   top signals, and proposed tweaks. Cross-reference `[[vault/...]]` notes.
6. **Apply**: if a proposed tweak is approved, make the AGENTS.md / hook / test
   change as a T1 task and link it back to the retro entry.

## Entries

<!-- Append retro sections here, newest first. -->

## 2026-07-30

**Window:** Tasks 001–035 (Jul 15–30, 2026)
**Throughput:** 35 tasks in 15 days (~2.3 tasks/day)

### By Category
| Category | Count | Examples |
|----------|-------|----------|
| Discipline enforcement | 6 | 009, 014, 025, 031, 032, 035 |
| Audit infrastructure | 8 | 020–024, 027–028, 033 |
| Bug fixes | 8 | 001, 004, 005, 015, 018, 029, 030, 034 |
| Features | 7 | 003, 007, 008, 010, 011, 017, 026 |
| Infrastructure | 6 | 016, 019, 021–022, 031, 034 |

### Systemic Signals

**Signal 1: Duplication across files (3+ occurrences)**
- `sync-status-map-duplication` — status map in 4 files
- `constant-drift-12-files` — APPROVED_PROJECT_IDS in 12 files
- `cjs-in-esm-pages` — 22 pages using CJS require
- `send500-bypass-6-routes` — 6 routes bypass send500
- **Root cause:** No automated DRY enforcement; copy-paste is faster than extraction
- **Proposed tweak:** Add `check-duplication.js` gate that flags known duplicated patterns (T1 task)

**Signal 2: Discipline needed 6 iterations to become blocking**
- Tasks 009, 014, 025, 031, 032, 035 all touched discipline enforcement
- Each iteration added a layer: scripts → hooks → plugin → blocking gates
- **Root cause:** Documentation-only protocols fail; automated enforcement is the only reliable path
- **Proposed tweak:** Already captured in `protocol-is-advisory-until-enforced` gotcha. No further action needed.

**Signal 3: Test coverage gaps found late**
- Task 033 added tests for 8 modules that had none
- `no-e2e-tests` gotcha (AUD-004) — Playwright installed but unused
- **Root cause:** Tests were optional, not blocking
- **Proposed tweak:** Already addressed by Task 035 (CI blocking tests). Consider adding pre-commit test coverage check for lib/ modules.

### What Worked Well
1. **Blast-radius tiering** — feature vs account classification prevents unnecessary gate overhead
2. **Sentinel-based bootstrap** — ISO content parsing is reliable and testable
3. **Board-driven workflow** — task board + vault created accountability loop
4. **3-tier enforcement model** — advisory → blocking → CI is the right escalation

### Proposed Tweaks (T1 tasks if approved)
1. `check-duplication.js` — gate script to flag known duplicated patterns
2. Pre-commit lib/ coverage check — fail if coverage drops below threshold
