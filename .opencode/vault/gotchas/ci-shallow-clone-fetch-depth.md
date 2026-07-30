# CI Shallow Clone Needs fetch-depth:0

## Gotcha
GitHub Actions `actions/checkout@v4` defaults to `fetch-depth: 1` (shallow clone). Scripts that run `git log` or `git diff` against `origin/main` fail or return incomplete results.

## Example
`check-discipline.js` runs `git log --oneline -- .opencode/vault/INDEX.md | head -10` to check vault freshness. With shallow clone, `git log` returns empty or incomplete history.

## Fix
Add `fetch-depth: 0` to the checkout step in `.github/workflows/ci.yml`:
```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

## Lesson
Any git history check in CI requires full clone. Always set `fetch-depth: 0` when scripts read git log/diff history.