# Family Tree — Backend Design Spec
Date: 2026-03-25

## Overview

Add a Node.js/Express backend backed by PostgreSQL (via Prisma) to the existing family tree visualiser. The frontend (`index.html`) is migrated from hardcoded JS arrays to fetching live data from the API. Users can extend the tree by clicking any person card to add a spouse or child via a modal form.

---

## Approach

**Thin REST + full re-render.** Simple Express endpoints serve and mutate data. After every successful mutation the frontend re-fetches `/api/tree` and re-runs the full D3 render. Re-render on this dataset is <10ms so there is no perceptible flicker. No WebSockets, no incremental DOM patching.

---

## Project Structure

```
family-tree/
├── index.html              ← frontend (updated to fetch from API)
├── architecture.md
└── server/
    ├── package.json
    ├── .env                ← DATABASE_URL, PORT
    ├── prisma/
    │   ├── schema.prisma
    │   └── seed.js         ← seeds all 38 people + 15 couples
    └── src/
        ├── index.js        ← Express entry point, serves index.html as static
        ├── lib/
        │   └── createPerson.js  ← shared person-creation + validation helper
        ├── routes/
        │   ├── tree.js     ← GET /api/tree
        │   ├── people.js   ← DELETE /api/people/:id
        │   └── couples.js  ← POST /api/couples, POST /api/couples/:id/children
        └── middleware/
            └── errorHandler.js
```

Express serves `index.html` as a static file using `express.static(path.join(__dirname, '../../'))` (two levels up from `server/src/`). One command (`node server/src/index.js`) starts everything — no separate frontend dev server.

---

## Database Schema (Prisma)

```prisma
model Person {
  id        String        @id @default(cuid())
  name      String
  birth     Int
  death     Int?
  gender    String        // "M" | "F"
  spouseAIn Couple?       @relation("SpouseA")
  spouseBIn Couple?       @relation("SpouseB")
  childIn   CoupleChild[]
}

model Couple {
  id        String        @id @default(cuid())
  spouseA   Person        @relation("SpouseA", fields: [spouseAId], references: [id])
  spouseAId String        @unique
  spouseB   Person        @relation("SpouseB", fields: [spouseBId], references: [id])
  spouseBId String        @unique
  children  CoupleChild[]
}

model CoupleChild {
  couple    Couple  @relation(fields: [coupleId], references: [id], onDelete: Cascade)
  coupleId  String
  child     Person  @relation(fields: [childId], references: [id])
  childId   String
  sortOrder Int     @default(0)

  @@id([coupleId, childId])
}
```

**Key constraints:**
- `spouseAId` and `spouseBId` are `@unique` — a person belongs to at most one couple.
- `spouseA` is always the bloodline member; `spouseB` is the married-in partner. This asymmetry is used only by the layout algorithm (connector drop-line target). **It is enforced by the UI and seed data only — the server does not validate bloodline membership.** Both spouses may add children through the UI — the couple is already established, so either card is a valid trigger.
- `CoupleChild` composite PK prevents duplicate parent–child links.
- `sortOrder` preserves sibling insertion order for the layout algorithm.
- `onDelete: Cascade` on `CoupleChild.couple` means deleting a `Couple` row automatically deletes its `CoupleChild` rows. This is used by `DELETE /api/people/:id` when dissolving a childless couple.

---

## API Endpoints

All prefixed `/api`. No authentication. All POST endpoints require `express.json()` middleware for body parsing.

### `GET /api/tree`

Returns the full tree. The route queries all couples with their `CoupleChild` relations (ordered by `sortOrder ASC`) and maps the result to a flat shape the frontend already expects.

The `couples` array is returned sorted so that the **root couple** (the one whose neither spouse appears as a child in any `CoupleChild` row) comes first. This preserves the `couples[0]` assumption in `assignGenerations()`. The simplest server-side approach: after fetching all couples, find the one whose `spouseAId` and `spouseBId` are absent from all `CoupleChild.childId` values, move it to index 0, then return the rest in insertion order.

**Response:**
```json
{
  "people": [
    { "id": "clx...", "name": "Arthur Smith", "birth": 1910, "death": 1985, "gender": "M" }
  ],
  "couples": [
    { "id": "clx...", "spouseA": "clx...", "spouseB": "clx...", "children": ["clx...", "clx..."] }
  ]
}
```

`couples[].children` is a flat array of person ID strings, sorted by `sortOrder`. The raw Prisma `CoupleChild[]` relation is mapped server-side before sending.

### `POST /api/people` — internal only, not a mounted route

Person creation is handled by a shared `createPerson(data, tx)` module function in `src/lib/createPerson.js`. It is called inside the Prisma transactions in `POST /api/couples` and `POST /api/couples/:id/children`. It is **not** exposed as an HTTP endpoint — doing so would allow creation of orphaned persons (no couple, no parent link) with no way to display them in the tree.

`createPerson` validates the input and throws a `400`-tagged error if invalid:
- `name` must be a non-empty string
- `birth` must be an integer in 1000–2100
- `death` must be absent, `null`, or an integer ≥ `birth`
- `gender` must be `"M"` or `"F"`

### `POST /api/couples`

Creates a new couple linking an existing bloodline person to a new spouse. Executes in a single Prisma transaction: create the new spouse person, then create the couple.

**Who calls this:** The frontend, when the user clicks "Add spouse" on a person who has no couple yet. The clicked person always becomes `spouseA` (the bloodline role). "Add spouse" is only shown for people who have no existing couple, so a married-in `spouseB` will never have this option available.

**Body:**
```json
{
  "existingPersonId": "clx...",
  "spouse": { "name": "Jane Doe", "birth": 1990, "death": null, "gender": "F" }
}
```

The `existingPersonId` person always becomes `spouseA`. No `role` field is needed.

**Response:** `201` with the created couple and both spouse IDs:
```json
{ "id": "clx...", "spouseAId": "clx...", "spouseBId": "clx..." }
```

**Errors:**
- `409 { "error": "Person already belongs to a couple" }` if `existingPersonId` is already `spouseA` or `spouseB` in any couple.
- `404 { "error": "Person not found" }` if `existingPersonId` does not exist.
- `400 { "error": "..." }` for invalid spouse fields (same rules as `POST /api/people`).

### `POST /api/couples/:id/children`

Adds a new child to an existing couple. Executes in a single Prisma transaction: create the child person, then create the `CoupleChild` row with `sortOrder = (current child count for this couple)`.

**Who calls this:** The frontend, when the user clicks "Add child" on either spouse. The frontend reads `couple.id` from the `/api/tree` response (cuid strings, not the original `c1`/`c2` keys) and passes it as `:id`.

**Body:**
```json
{ "name": "Ben Smith", "birth": 2015, "death": null, "gender": "M" }
```

**Response:** `201` with the created child person:
```json
{ "id": "clx...", "name": "Ben Smith", "birth": 2015, "death": null, "gender": "M" }
```

**Errors:**
- `404 { "error": "Couple not found" }` if `:id` does not exist.
- `400 { "error": "..." }` for invalid person fields.

### `DELETE /api/people/:id`

Removes a person and, if they belong to a couple, dissolves that couple. Deletion behaviour is asymmetric based on role:

- **Deleting spouseB (married-in):** The couple is dissolved. spouseA remains in the tree as an uncoupled bloodline node.
- **Deleting spouseA (bloodline):** spouseB has no parent `CoupleChild` link and would become unreachable in the tree if left behind. spouseB is therefore **automatically deleted in the same transaction**. Both persons are removed.

**Guard:** Deletion is only allowed if the person's couple has no children. If the couple has children, the request is rejected regardless of role — a parent cannot be removed while descendants exist.

**Transaction steps (single Prisma transaction):**
1. Look up the person; `404` if not found.
2. Find the couple where `spouseAId = id` OR `spouseBId = id`, if any.
3. If a couple is found and it has one or more `CoupleChild` rows, return `409`.
4. If the person is `spouseA` of the couple: delete the `CoupleChild` row where `childId = spouseBId`, if any, then delete the `spouseB` Person row. SpouseB may have been a bloodline child of another couple before marrying in (the schema permits this even though the UI does not produce it); this step removes that record to satisfy the FK constraint before the Person row is deleted. Omitting this step would cause a constraint violation at runtime if such a record exists.
5. Delete the `Couple` row. `onDelete: Cascade` automatically removes its `CoupleChild` rows (zero in this case, but the cascade prevents any FK violation).
6. Delete the `CoupleChild` row where `childId = id` (removes the target person from their own parent couple's children list), if any. **Must execute before step 7.**
7. Delete the target `Person` row.

**Response:** `200 { "deleted": ["clx..."] }` — array of deleted person IDs. Contains one ID (spouseB or a solo/uncoupled person) or two IDs (spouseA + their spouseB) depending on the case. The client re-fetches `/api/tree` immediately; the array is provided only so the client can confirm what was removed.

**Errors:**
- `404 { "error": "Person not found" }` if `:id` does not exist.
- `409 { "error": "Cannot remove a person who has children" }` if their couple has children.

---

## Frontend Changes (`index.html`)

Four focused changes. The layout algorithm and D3 render code are unchanged.

### 1. Data loading and re-render lifecycle

Remove hardcoded `people` and `couples` arrays. Extract the existing IIFE into a named async `init()` function that:

1. Fetches `/api/tree` to get `{ people, couples }`.
2. Rebuilds `personMap` (`id → Person`) and `personCouple` (`personId → Couple`) from the fetched data. These are currently module-level constants computed once from hardcoded arrays; after migration they must be recomputed inside `init()` on every call so they reflect the latest DB state.
3. Runs `assignGenerations()`, `computeSubtreeWidths()`, `computePositions()`.
4. Clears `connectorLayer` and `nodeLayer` (`.selectAll('*').remove()`).
5. Re-runs `renderConnectors()` and `renderNodes()`.
6. Updates the zoom fit: after `assignGenerations()`, compute `maxGen = Math.max(...couples.map(c => c.gen))` and use `(maxGen + 1) * ROW_HEIGHT + PADDING * 2` as `treeH` rather than the current hardcoded `5 * ROW_HEIGHT + PADDING * 2`. This keeps the fit-on-load calculation correct as the tree grows.

The `svg` and `zoomLayer` elements are created once on page load and never rebuilt. The zoom behaviour and current transform survive re-renders. Before clearing the layers, save the current transform via `d3.zoomTransform(svg.node())` and reapply it after rendering so the user's viewport position is preserved.

`init()` is called once on page load, then again after every successful mutation.

### 2. Click handler

Each `<g.person>` receives a `click` listener that calls `event.stopPropagation()` (prevents D3 drag interference) and renders the context menu near the clicked card.

The listener receives the D3 datum `d` which includes `d.person` (the Person object including its `id`) and `d.coupleId` — the ID of the couple this person belongs to as either spouse, if any. This is populated when building `nodeData` in `renderNodes()`: for each couple, both the spouseA datum and the spouseB datum receive `coupleId = couple.id`.

### 3. Context menu

A `<div id="ctx-menu">` appended once to `<body>`, hidden by default, shown with `position:fixed` near the click coordinates.

**"Add spouse" button:** Visible and enabled only if the clicked person has no couple. Determined client-side by checking whether the person's ID appears as `spouseA` or `spouseB` in any couple in the current tree data.

**"Add child" button:** Visible and enabled if the clicked person belongs to a couple (`d.coupleId` is set) — available to both spouseA and spouseB. If the person has no couple yet, shown disabled with tooltip "Add a spouse first."

**"Remove" button:** Always visible. Enabled if the person has no couple OR if their couple has no children (determined client-side from the current tree data). Disabled with tooltip "Cannot remove a person with children" if their couple has children.

Clicking an enabled "Remove" button transitions the context menu into a confirmation state before issuing the DELETE request. The confirmation message varies by case:
- Person has no couple: "Remove [name]? This cannot be undone."
- Person is `spouseB` of a childless couple: "Remove [name]? Their couple will be dissolved. This cannot be undone."
- Person is `spouseA` of a childless couple: "Remove [name]? This will also remove their spouse [spouseB name]. This cannot be undone."

The frontend determines the person's role by checking whether their ID matches `couple.spouseA` or `couple.spouseB` in the current tree data.

While a DELETE request is in flight, the outside-click dismiss handler is suppressed and the Confirm/Cancel buttons are replaced with a loading indicator. This prevents the menu from being dismissed before the response arrives. On success, dismiss the menu and call `init()`. On error, restore the Confirm/Cancel buttons and show the error text inline.

Clicking outside the menu (document click listener) dismisses it, except while a request is in flight.

### 4. Modal form

A `<div id="modal">` appended once to `<body>`. Title changes to "Add Spouse" or "Add Child" depending on context (no modal for Remove — confirmation lives inline in the context menu). Fields:

| Field | Type | Validation |
|-------|------|------------|
| Name | text input | required, non-empty |
| Birth year | number input | required, 1000–2100 |
| Death year | number input | optional, must be ≥ birth year if provided |
| Gender | M / F radio | required |

On submit: POST to the appropriate endpoint. On success: close modal, call `init()` to re-fetch and re-render. On error (`4xx`/`5xx`): show the `error` field from the response body as an inline message inside the modal, leave it open.

On Remove confirm: `DELETE /api/people/:id`. On success: dismiss context menu, call `init()`. On error: show error text inside the context menu confirmation area.

No new JS libraries. Menu and modal are plain HTML + inline styles consistent with the existing dark theme (`#0f1117` background, `#ffffff` text, blue/rose accents).

---

## Seed Script (`prisma/seed.js`)

Translates the current hardcoded arrays verbatim into Prisma writes. The script is **idempotent**: it runs `deleteMany` on `CoupleChild`, `Couple`, and `Person` (in that order, to respect FK constraints) before inserting, so it can be re-run safely.

Steps:
1. Delete all `CoupleChild`, then `Couple`, then `Person` rows (FK-safe deletion order).
2. Insert all 38 people one at a time using `prisma.person.create` (not `createMany` — `createMany` does not return created IDs in PostgreSQL without Prisma 5.14+ `createManyAndReturn`). Build a `{ p1: "<cuid>", p2: "<cuid>", ... }` mapping as each person is created.
3. Insert all 15 couples via `prisma.couple.create`, resolving `spouseAId` and `spouseBId` from the mapping.
4. Insert all `CoupleChild` rows via `prisma.coupleChild.create`, assigning `sortOrder` equal to each child's index within the original `children` array.

Run with `npx prisma db seed`.

---

## Error Handling

`errorHandler.js` Express middleware catches unhandled errors and returns:

```json
{ "error": "Human-readable message" }
```

| Prisma error code | HTTP status |
|-------------------|-------------|
| `P2002` (unique constraint) | `409` |
| `P2025` (record not found) | `404` |
| all others | `500` |

Input validation (blank name, invalid year, etc.) is handled in each route and returns `400` before any Prisma call.

---

## Environment

```
# server/.env
DATABASE_URL="postgresql://user:password@localhost:5432/family_tree"
PORT=3000
```

`index.js` uses `process.env.PORT || 3000` so the server starts even if `PORT` is absent from `.env`.

---

## Out of Scope

- Authentication / authorisation
- Editing existing person details (name, birth year, etc.)
- Remarriage (a person in an existing couple cannot be given a second spouse)
- Real-time multi-user sync
- Removing a person who has children (must remove descendants first)
