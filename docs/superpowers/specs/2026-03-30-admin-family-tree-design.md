# Admin Interface & Multi-Tree Support — Design Spec

**Date:** 2026-03-30
**Status:** Approved

---

## Overview

Add an admin interface (`admin.html`) where a central administrator can create and manage multiple independent family trees. Each tree has a unique identifier and name. The admin can open any tree in the existing tree viewer (`index.html`). This is a prototype for future multi-tree support and customer onboarding flows.

**Out of scope:** user authentication, per-user tree access control, cross-tree marriages, onboarding flow for end users.

---

## 1. Data Model

### New model: `FamilyTree`

```prisma
model FamilyTree {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  people    Person[]
}
```

### Modified model: `Person`

Add a required `treeId` foreign key:

```prisma
model Person {
  // ...existing fields unchanged...
  treeId    String
  tree      FamilyTree @relation(fields: [treeId], references: [id])
}
```

**`Couple` and `CoupleChild` are unchanged.** A couple's tree is inferred from its spouses — both spouses must share the same `treeId`, enforced at the API level. Cross-tree marriages are out of scope.

### Migration

1. Insert a `FamilyTree` record with name `"Demo Tree"`.
2. Set `treeId` on all existing `Person` rows to that record's id.
3. Apply the `NOT NULL` constraint on `Person.treeId`.

---

## 2. API Routes

### New routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/trees` | List all trees with root couple names |
| POST | `/api/trees` | Create tree + root couple + optional children (single transaction) |

**`GET /api/trees` response:**
```json
[
  {
    "id": "clxxx",
    "name": "The Rajan Family",
    "createdAt": "2026-03-30T00:00:00.000Z",
    "rootCouple": {
      "spouseA": "Arjun Rajan",
      "spouseB": "Priya Rajan"
    }
  }
]
```

**`POST /api/trees` request body:**
```json
{
  "name": "The Rajan Family",
  "spouseA": { "name": "Arjun Rajan", "birth": 1960, "gender": "M" },
  "spouseB": { "name": "Priya Rajan", "birth": 1963, "gender": "F" },
  "children": [
    { "name": "Rahul Rajan", "birth": 1985, "gender": "M" },
    { "name": "Sneha Rajan", "birth": 1988, "gender": "F" }
  ]
}
```

`children` is optional and may be an empty array. `name`, `spouseA`, and `spouseB` are required. Creation runs in a single Prisma transaction — if any step fails the whole operation rolls back.

**Transaction steps:**
1. Create `FamilyTree { name }`
2. Create `Person` spouseA `{ ...fields, treeId }`
3. Create `Person` spouseB `{ ...fields, treeId }`
4. Create `Couple { spouseAId, spouseBId }`
5. For each child (in order): create `Person { ...fields, treeId }`, create `CoupleChild { coupleId, childId, sortOrder: index }`

### Modified routes

All existing routes that read or write tree-scoped data require a `?treeId=` query param. Missing or unknown `treeId` returns `400`.

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/tree?treeId=X` | Filter people + couples to treeId=X; include tree name in response |
| POST | `/api/couples?treeId=X` | Assign new people to treeId=X |
| POST | `/api/couples/:id/children?treeId=X` | Validate child belongs to same tree |
| DELETE | `/api/people/:id` | No change — person carries its own treeId |
| PUT | `/api/people/:id` | No change |

---

## 3. Frontend: `admin.html`

A new standalone HTML page (no framework, matching project conventions).

### Dashboard view

- Header: "Family Tree Admin"
- Card grid of all trees fetched from `GET /api/trees`
- Each card shows: tree name, root couple names, creation date, "View Tree →" button
- First card is a dashed `+` card that opens the creation wizard
- "View Tree →" navigates to `index.html?treeId=<id>`

### Creation wizard (3-step modal)

**Step 1 — Tree name**
- Single input: tree name (required)
- Back (closes modal) / Next

**Step 2 — Root couple**
- Two side-by-side sections: Spouse A and Spouse B
- Fields per spouse: full name (required), birth year (required), gender M/F (required)
- Back / Next

**Step 3 — Add children + preview**

Layout:
- **Mobile (< 768px):** mini tree preview stacked on top, children form below
- **Desktop (≥ 768px):** children form on left, mini tree preview on right

Mini tree preview:
- Renders couple cards (matching the blue/pink colour scheme from `index.html`) with connector lines
- Updates live as children are added or removed
- Pure HTML/CSS — no D3, no SVG required at this scale

Children form:
- Each row: name, birth year, gender, remove (✕) button
- `+ Add Child` appends a new row
- Children are optional — wizard can be submitted with zero children

On "Create Tree": `POST /api/trees` with all collected data. On success, close modal and prepend the new card to the dashboard grid.

---

## 4. Frontend: `index.html` changes

Minimal changes to the existing tree viewer:

- On page load, read `treeId` from the `?treeId=` query param. If absent, display an error message: *"No tree selected. Return to Admin."* with a link to `admin.html`.
- Append `?treeId=X` to all `fetch()` calls: `/api/tree`, `/api/couples`, `/api/couples/:id/children`.
- Show the tree name (returned in `GET /api/tree` response) in the page header.
- Add a "← Admin" back link in the top-left corner that navigates to `admin.html`.

No changes to layout algorithm, rendering, zoom/pan, or context menu interactions.

---

## 5. Testing

New file: `server/__tests__/trees.test.js`

Tests use unique name suffixes (e.g. `Date.now()`) to avoid conflicts between runs. `clearDatabase()` is not called.

**`POST /api/trees` cases:**
- Creates tree + couple with no children
- Creates tree + couple + children, verifies sort order on CoupleChild
- Returns 400 if `name` is missing
- Returns 400 if `spouseA` is missing
- Returns 400 if `spouseB` is missing

**`GET /api/trees` cases:**
- Returns list including newly created tree with correct root couple names

**`GET /api/tree?treeId=X` cases:**
- Returns only people and couples belonging to that tree
- Returns 400 if `treeId` param is missing
- Returns 400 if `treeId` is unknown

**Existing test files (`couples.test.js`, `people.test.js`):**
- Each test that calls tree-scoped routes creates its own `FamilyTree` first (via `POST /api/trees` or direct Prisma insert in test setup) and passes `?treeId=X` on all calls.

---

## 6. Future considerations (not in scope)

- Per-user tree access (users see only their own tree)
- User onboarding flow (first-time tree creation for a new customer)
- Cross-tree marriages (spouses from different trees)
- Central admin authentication
