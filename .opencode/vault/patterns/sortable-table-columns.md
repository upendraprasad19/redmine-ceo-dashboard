# Per-accordion table column sorting

**Type:** pattern  
**Date:** 2026-07-16  
**Related:** [[scroll-jump-from-global-sort]]  
**Tags:** #ui #sorting #react

## What
Each project accordion has its own independent sort state. Clicking sort inside one accordion does NOT reorder other accordions' DOM, preventing scroll anchoring from jumping the page.

## Detail
Pattern used in `components/Dashboard.js` `Tickets()` component:

### State
Single `sortState` object keyed by project name:
```js
const [sortState, setSortState] = useState({});
// shape: { 'iCLAIMS': { by: 'created', dir: 'asc' } }
```

### Flow
1. Group tickets by project (`groupBy(filteredTix, "project_name")`)
2. In each accordion callback: `const groupTix = s.by ? sortGroup(tix, s) : tix;`
3. Render `groupTix.map(...)` rows inside that accordion

### Helpers
- `sortGroup(tix, { by, dir })` — stable sort with null-last for due_date
- `sortHeader(label, proj)` — reads `sortState[proj]` for active/direction indicators (↑↓↕)
- `handleSort(col, proj)` — three-state cycle per project: new col → asc → desc → clear

### Key detail
The three-state cycle clears the sort entirely on third click (removes the key from `sortState`), so the accordion reverts to the default sort (created date descending). The header indicator remains active to reflect this.

## Evidence
- `components/Dashboard.js:825-1030` — `Tickets()` function
- Commit `bf6f3cb`

## Revisit if
Adding new sortable columns, changing column layout, or if browser scroll-anchoring behavior changes.
