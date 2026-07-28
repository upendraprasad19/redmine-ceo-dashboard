# Bug-fix verification

Load this skill before committing a bug fix. Verify each layer:

1. [ ] **API layer**: Does the endpoint return the correct response?
2. [ ] **DB layer**: Is the query correct? Does the column exist?
3. [ ] **Frontend**: Does the UI render correctly?
4. [ ] **Error handling**: Are errors caught and reported (send500)?
5. [ ] **Regression test**: Does a test exist that FAILS without the fix?
