# Skill: discipline-check

## What I do
Validate that the discipline protocol from `.opencode/AGENTS.md` was followed during a session. Run this before committing or when user asks "was discipline followed?"

## Checklist (from AGENTS.md §B)

### Session Start (§A)
- [ ] Read `.opencode/board/INDEX.md`
- [ ] Read `.opencode/vault/INDEX.md`
- [ ] Run `git status`
- [ ] Check `.env.local` has valid DATABASE_URL and REDMINE_API_KEY

### Plan-First (§B)
- [ ] Tier assessed (T0/T1/T2)
- [ ] Plan file created in `board/active/` (T1/T2)
- [ ] Reviewer subagent used (T2 only)
- [ ] User approval obtained before building

### Post-Edit (§C)
- [ ] `npm run test:unit` passes
- [ ] Board updated (`node scripts/board.js start/done`)
- [ ] Vault updated if new pattern/gotcha discovered
- [ ] Dev server check (if applicable)

### Pre-Commit (§D)
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Self-learning run
- [ ] Code review presented to user
- [ ] Vault + board INDEX.md current

## How to use
1. Run at end of session: `skill discipline-check`
2. Run before commit: `skill discipline-check`
3. Run when user asks about discipline

## Output
```
DISCIPLINE CHECK — Session X
✅ Session start: board read, vault read, git status checked
❌ Plan-first: No plan file created (T2 task)
✅ Post-edit: Tests pass, board updated
❌ Pre-commit: Self-learning not run

Violations: 2
- Missing plan file for T2 task
- Missing self-learning after batch
```

## Enforcement rules
- **T0 tasks**: Skip plan file, but still run tests and update board
- **T1 tasks**: Plan file required (lightweight)
- **T2 tasks**: Full plan + reviewer subagent required
- **Every session**: Board + vault read at start is mandatory
