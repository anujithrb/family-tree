# Relationship Finder — Design Spec

**Date:** 2026-03-28
**Status:** Approved

---

## Overview

A new page (`relationship.html`) where the user selects two people from the family tree and sees a filtered subtree SVG showing only the nodes relevant to their connection. The path-finding logic lives on the backend so it can be reused by future clients (mobile apps, etc.).

---

## Backend API

### `GET /api/relationship?a=<personId>&b=<personId>`

Builds an undirected adjacency graph from all people and couples:
- Each person ↔ their spouse (via their couple)
- Each person ↔ their children (via `CoupleChild`)
- Each child ↔ their parents

Runs BFS from `a` to `b` to find the shortest path.

**Success response `200`:**
```json
{
  "path": ["id1", "id2", "id3"],
  "people": [...],
  "couples": [...]
}
```

- `path` — ordered person IDs from A to B
- `people` — full Person objects for all people needed to render the subtree
- `couples` — Couple objects for: any couple where at least one spouse is in `path`, plus their spouses (so couples render as pairs)

**Error responses:**
- `400` — either `a` or `b` query param is missing or does not match any person
- `404` — no path exists between the two people (disconnected)

**New file:** `server/src/routes/relationship.js`
**Registered in:** `server/src/index.js`
**Test file:** `server/__tests__/relationship.test.js`

---

## Frontend — `relationship.html`

### Layout

- Same dark theme (`#0f1117` background), color constants, and card style as `index.html`
- **Top bar:** "← Back to Tree" link on the left, "Relationship Finder" page title centered
- **Search row:** Two type-ahead inputs side by side — "Person A" and "Person B". Each shows a live-filtered name dropdown populated from `/api/tree`
- **Find button:** Triggers the API call; disabled until both inputs have a valid selection
- **SVG canvas:** Below the search row; same D3 zoom/pan setup (`scaleExtent: [0.2, 3]`) as the main tree

### Navigation from Main Tree

Right-clicking a person on `index.html` gains a new **"Find Relationship To…"** context menu item (added below "Edit", above the separator before "Remove").

Clicking it navigates to `relationship.html?a=<personId>`. On load, if `?a=` is present in the URL, Person A's input is pre-filled with that person's name and the cursor is placed in Person B's field.

### Subtree Rendering

Reuses the same 4-phase layout pipeline (`assignGenerations`, `computeSubtreeWidths`, `computePositions`, render) operating only on the `people` and `couples` arrays returned by the API.

**Visual distinction:**

| Node type | Style |
|-----------|-------|
| On the path (`path[]`) | Normal card + gold stroke (`#f0c040`), `stroke-width: 2.5` |
| Spouse of path node (not in path) | 50% opacity, dashed card border |
| Connectors between path nodes | Solid, `#ffffff`, `stroke-width: 2` |
| Connectors to/from de-emphasized nodes | Dashed (`stroke-dasharray: 4,3`), `#555`, `stroke-width: 1.5` |

### States

- **Loading:** "Finding relationship…" text shown in SVG area while fetch is in flight
- **No path:** Centered message — *"No relationship found between these two people."*
- **Same person selected for both:** Client-side validation error shown inline before any fetch — *"Please select two different people."*
- **API error:** Brief error message below the search row

---

## Testing

File: `server/__tests__/relationship.test.js`

| Test | Description |
|------|-------------|
| Parent → child | Returns a 2-node path |
| Grandparent → grandchild | Returns correct 3-node path through parent |
| Cousins | Path goes up to common ancestor and back down |
| Unrelated/disconnected | Returns `404` |
| Missing param | Returns `400` |
| Invalid ID | Returns `400` |

---

## Out of Scope

- Relationship label (e.g. "grandfather", "2nd cousin") — not shown in this version
- Siblings are not added to the subtree; only path nodes and their spouses are rendered
- No editing/mutations from the relationship page (read-only view)
