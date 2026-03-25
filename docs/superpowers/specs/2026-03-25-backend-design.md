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
        ├── routes/
        │   ├── tree.js     ← GET /api/tree
        │   ├── people.js   ← POST /api/people
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
  couple    Couple  @relation(fields: [coupleId], references: [id])
  coupleId  String
  child     Person  @relation(fields: [childId], references: [id])
  childId   String
  sortOrder Int     @default(0)

  @@id([coupleId, childId])
}
```

**Key constraints:**
- `spouseAId` and `spouseBId` are `@unique` — a person belongs to at most one couple.
- `spouseA` is always the bloodline member; `spouseB` is the married-in partner. This is required by the layout algorithm which drops the parent→child connector to `spouseA`'s card top-centre. This asymmetry is intentional and permanent — `spouseB` people cannot add children through the UI.
- `CoupleChild` composite PK prevents duplicate parent–child links.
- `sortOrder` preserves sibling insertion order for the layout algorithm.

---

## API Endpoints

All prefixed `/api`. No authentication. All POST endpoints require `express.json()` middleware for body parsing.

### `GET /api/tree`

Returns the full tree. The route queries all couples with their `CoupleChild` relations (ordered by `sortOrder ASC`) and maps the result to a flat shape the frontend already expects.

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

**Who calls this:** The frontend, when the user clicks "Add child" on a `spouseA` person. The frontend reads `couple.id` from the `/api/tree` response (cuid strings, not the original `c1`/`c2` keys) and passes it as `:id`.

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

---

## Frontend Changes (`index.html`)

Four focused changes. The layout algorithm and D3 render code are unchanged.

### 1. Data loading and re-render lifecycle

Remove hardcoded `people` and `couples` arrays. Extract the existing IIFE into a named async `init()` function that:

1. Fetches `/api/tree`
2. Runs `assignGenerations()`, `computeSubtreeWidths()`, `computePositions()` with the fetched data
3. Clears `connectorLayer` and `nodeLayer` (`.selectAll('*').remove()`)
4. Re-runs `renderConnectors()` and `renderNodes()`

The `svg` and `zoomLayer` elements are created once on page load and never rebuilt. The zoom behaviour and current transform are attached to `svg` and survive re-renders. Before clearing the layers, the current transform is read via `d3.zoomTransform(svg.node())` and reapplied after rendering so the user's viewport position is preserved.

`init()` is called once on page load, then again after every successful mutation.

### 2. Click handler

Each `<g.person>` receives a `click` listener that calls `event.stopPropagation()` (prevents D3 drag interference) and renders the context menu near the clicked card.

The listener receives the D3 datum `d` which includes `d.person` (the Person object including its `id`) and also a reference to `d.coupleId` — the ID of the couple this person is `spouseA` of, if any. This is populated when building `nodeData` in `renderNodes()`: for each couple, `spouseAId` is stored on the spouseA datum as `coupleId`.

### 3. Context menu

A `<div id="ctx-menu">` appended once to `<body>`, hidden by default, shown with `position:fixed` near the click coordinates.

**"Add spouse" button:** Visible and enabled only if the clicked person has no couple (neither `spouseAIn` nor `spouseBIn` is set). This is determined client-side by checking whether the person's ID appears as `spouseA` or `spouseB` in any couple in the current tree data.

**"Add child" button:** Visible and enabled only if the clicked person is `spouseA` of a couple (i.e. `d.coupleId` is set). If the person has no couple yet, the button is shown disabled with tooltip text "Add a spouse first." If the person is `spouseB`, the button is hidden entirely — this asymmetry is intentional (only bloodline `spouseA` members can add children).

Clicking outside the menu (document click listener) dismisses it.

### 4. Modal form

A `<div id="modal">` appended once to `<body>`. Title changes to "Add Spouse" or "Add Child" depending on context. Fields:

| Field | Type | Validation |
|-------|------|------------|
| Name | text input | required, non-empty |
| Birth year | number input | required, 1000–2100 |
| Death year | number input | optional, must be ≥ birth year if provided |
| Gender | M / F radio | required |

On submit: POST to the appropriate endpoint. On success: close modal, call `init()` to re-fetch and re-render. On error (`4xx`/`5xx`): show the `error` field from the response body as an inline message inside the modal, leave it open.

No new JS libraries. Menu and modal are plain HTML + inline styles consistent with the existing dark theme (`#0f1117` background, `#ffffff` text, blue/rose accents).

---

## Seed Script (`prisma/seed.js`)

Translates the current hardcoded arrays verbatim into Prisma writes. The script is **idempotent**: it runs `deleteMany` on `CoupleChild`, `Couple`, and `Person` (in that order, to respect FK constraints) before inserting, so it can be re-run safely.

Steps:
1. Delete all `CoupleChild`, then `Couple`, then `Person` rows.
2. Insert all 38 people via `prisma.person.createMany`. Capture the mapping of original keys (`p1`…`p38`) to generated cuid IDs by creating each person individually and building a `{ p1: "<cuid>", ... }` map.
3. Insert all 15 couples via `prisma.couple.create`, looking up spouse IDs via the map.
4. Insert all `CoupleChild` rows, assigning `sortOrder` by each child's index in the original `children` array.

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

---

## Out of Scope

- Authentication / authorisation
- Editing or deleting existing nodes
- Remarriage (a person in an existing couple cannot be given a second spouse)
- Real-time multi-user sync
- `spouseB`-initiated child additions
