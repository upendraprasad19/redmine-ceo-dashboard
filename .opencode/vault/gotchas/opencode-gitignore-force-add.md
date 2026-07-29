# .opencode/ is gitignored — need git add -f

`.gitignore` excludes `.opencode/`. Any files under that path (hooks, skills, plans) are **local-only** unless explicitly `git add -f`'d.

**When adding tracked files under `.opencode/`:**
- Skills: `git add -f .opencode/skills/<name>/SKILL.md`
- Hooks: `git add -f .opencode/hook/hooks.yaml`
- Plans: `.opencode/plans/` is already tracked (excluded from gitignore)

**Risk:** If forgotten, the file exists locally but won't be in the repo. Other developers or CI won't see it.

**Source:** Task 025 — bug-fix-verification skill and hooks.yaml needed `git add -f`.
