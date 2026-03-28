# Family Tree — Prototype Knowledge Export

**Source project:** `family-tree` prototype (Express + PostgreSQL + vanilla JS/D3)
**Export date:** 2026-03-28
**Purpose:** Reference for building a production-grade family management app with a separate backend API (Angular web, Android, iOS clients)

---

## Table of Contents

1. [What This Prototype Proved](#1-what-this-prototype-proved)
2. [Data Model](#2-data-model)
3. [Tree Layout Algorithm](#3-tree-layout-algorithm)
4. [API Design](#4-api-design)
5. [UI Patterns](#5-ui-patterns)
6. [Features Implemented](#6-features-implemented)
7. [Visual Design](#7-visual-design)
8. [Design Decisions & Rationale](#8-design-decisions--rationale)
9. [Known Gaps / Deferred Work](#9-known-gaps--deferred-work)
10. [Adaptation Notes for the Production App](#10-adaptation-notes-for-the-production-app)

---

## 1. What This Prototype Proved

- A **couple-centric data model** (Person + Couple + CoupleChild junction) is the right foundation — not a person-centric parent/child tree. Couples are first-class entities, which correctly models marriages and enables the layout algorithm.
- A **4-phase layout algorithm** (generation assignment → subtree widths → x/y positions → render) produces clean top-down family trees without needing D3's built-in `d3.tree()` (which has no concept of couple nodes).
- **Full re-fetch + full re-render** after every mutation is fast enough (<10ms on this dataset) and radically simpler than incremental updates. Production apps with larger datasets may need pagination or lazy loading.
- The **relationship finder** (BFS shortest path between two people) is correctly placed on the backend so it can be reused by all clients.
- **Profile picture upload** via `multipart/form-data` works well; the key lesson is the safe replacement order: write new file → update DB → delete old file (never delete old file before DB commits).

---

## 2. Data Model

### Core Schema (Prisma, PostgreSQL)

```prisma
model Person {
  id             String        @id @default(cuid())
  name           String
  birth          Int
  death          Int?          // null = still alive
  gender         String        // "M" | "F"
  profilePicture String?       // relative URL e.g. "/uploads/<uuid>.jpg"
  spouseAIn      Couple?       @relation("SpouseA")
  spouseBIn      Couple?       @relation("SpouseB")
  childIn        CoupleChild[]
}

model Couple {
  id        String        @id @default(cuid())
  spouseA   Person        @relation("SpouseA", fields: [spouseAId], references: [id])
  spouseAId String        @unique   // one couple max per person
  spouseB   Person        @relation("SpouseB", fields: [spouseBId], references: [id])
  spouseBId String        @unique   // one couple max per person
  children  CoupleChild[]
}

model CoupleChild {
  couple    Couple  @relation(fields: [coupleId], references: [id], onDelete: Cascade)
  coupleId  String
  child     Person  @relation(fields: [childId], references: [id])
  childId   String
  sortOrder Int     @default(0)  // preserves birth order for layout

  @@id([coupleId, childId])       // no duplicate parent–child links
}
```

### ER Diagram

```
PERSON ||--o| COUPLE        : "is spouseA of"
PERSON ||--o| COUPLE        : "is spouseB of"
COUPLE ||--o{ COUPLE_CHILD  : "has"
PERSON ||--o{ COUPLE_CHILD  : "appears as child in"
```

### Key Constraints & Rules

- `spouseAId` and `spouseBId` are `@unique` — **one couple maximum per person**.
- `spouseA` = the bloodline member (the person who was already in the tree). `spouseB` = the married-in partner. This asymmetry only matters to the layout algorithm and the deletion logic. It is **enforced by UI/seed only** — the DB has no bloodline concept.
- A person can appear as `spouseA` in their own couple **and** as a child in their parent's `CoupleChild` — this is the generational linking mechanism.
- Married-in spouses (`spouseB`) have **no `CoupleChild` row** in any other couple; they enter the tree only by marrying in.
- `CoupleChild.sortOrder` preserves sibling birth order. Assigned as the current child count for the couple at insert time (0-indexed).
- `onDelete: Cascade` on `CoupleChild.couple` — deleting a `Couple` row auto-deletes its `CoupleChild` rows.

### Person Validation Rules

| Field    | Rule |
|----------|------|
| `name`   | Non-empty string, required |
| `birth`  | Integer 1000–2100, required |
| `death`  | Integer ≥ `birth` if provided; optional |
| `gender` | `"M"` or `"F"`, required |

### Root Couple Detection

The root couple (top of the tree / generation 0) is the couple whose both spouses do not appear as a child in any `CoupleChild` row. This is computed server-side on `GET /api/tree` to ensure `couples[0]` is always the root. The rest are returned in insertion order.

---

## 3. Tree Layout Algorithm

The layout is a custom 4-phase pipeline. D3's `d3.tree()` is **not used** — it has no concept of couple nodes.

### Layout Constants (Reference Values from Prototype)

| Constant      | Value  | Meaning |
|---------------|--------|---------|
| `NODE_W`      | 120px  | Person card width |
| `NODE_H`      | 60px   | Person card height |
| `SPOUSE_GAP`  | 12px   | Gap between the two spouse cards in a couple |
| `SUBTREE_GAP` | 48px   | Gap between adjacent sibling subtrees |
| `ROW_HEIGHT`  | 120px  | Vertical distance between generation top edges |
| `VERTICAL_GAP`| 60px   | Space between bottom of parent row and top of child row (`ROW_HEIGHT = NODE_H + VERTICAL_GAP`) |
| `PADDING`     | 40px   | Canvas padding on all sides |

**Couple unit width** = `NODE_W + SPOUSE_GAP + NODE_W` = 252px
**Couple center X** (`cx`) = `left + NODE_W + SPOUSE_GAP / 2`

---

### Phase 1 — Generation Assignment (Top-Down BFS)

```
root couple → gen = 0
each child who has their own couple → gen = parent.gen + 1
```

```js
function assignGenerations(couples, personCouple) {
  const root = couples[0]; // root couple must be at index 0
  root.gen = 0;
  const queue = [root];
  while (queue.length) {
    const couple = queue.shift();
    couple.children.forEach(childId => {
      const childCouple = personCouple[childId];
      if (childCouple && childCouple.gen === undefined) {
        childCouple.gen = couple.gen + 1;
        queue.push(childCouple);
      }
    });
  }
}
```

Solo leaf children (children who never form a couple) are **not assigned a couple gen**. Their generation is derived as `parentCouple.gen + 1` and they are positioned as solo nodes.

---

### Phase 2 — Subtree Widths (Bottom-Up, Deepest Gen First)

Each couple's `subtreeWidth` = the horizontal space its entire descendant tree needs.

```js
function computeSubtreeWidths(couples, personCouple) {
  const COUPLE_W = NODE_W * 2 + SPOUSE_GAP; // 252px minimum
  const maxGen = Math.max(...couples.map(c => c.gen));

  for (let gen = maxGen; gen >= 0; gen--) {
    couples.filter(c => c.gen === gen).forEach(couple => {
      const childCouples = couple.children
        .map(pid => personCouple[pid])
        .filter(Boolean);

      const soloCount = couple.children.filter(pid => !personCouple[pid]).length;
      const soloWidth = soloCount > 0
        ? soloCount * NODE_W + (soloCount - 1) * SUBTREE_GAP
        : 0;

      if (childCouples.length === 0) {
        // Leaf couple
        couple.subtreeWidth = Math.max(COUPLE_W, soloWidth || COUPLE_W);
      } else {
        const coupledWidth = childCouples.reduce((s, cc) => s + cc.subtreeWidth, 0)
          + (childCouples.length - 1) * SUBTREE_GAP;
        couple.subtreeWidth = Math.max(coupledWidth, soloWidth);
      }
    });
  }
}
```

---

### Phase 3 — X/Y Position Assignment (Top-Down BFS)

```js
function computePositions(couples, personMap, personCouple) {
  const root = couples[0];
  root.cx = root.subtreeWidth / 2 + PADDING;

  const queue = [root];
  while (queue.length) {
    const couple = queue.shift();

    couple.y    = couple.gen * ROW_HEIGHT + PADDING;
    couple.yBot = couple.y + NODE_H;
    couple.spouseAX = couple.cx - SPOUSE_GAP / 2 - NODE_W;
    couple.spouseBX = couple.cx + SPOUSE_GAP / 2;

    // Position child COUPLES
    const childCouples = couple.children
      .map(pid => personCouple[pid])
      .filter(Boolean);

    if (childCouples.length > 0) {
      const totalW = childCouples.reduce((s, cc) => s + cc.subtreeWidth, 0)
        + (childCouples.length - 1) * SUBTREE_GAP;
      let x = couple.cx - totalW / 2;
      childCouples.forEach(cc => {
        cc.cx = x + cc.subtreeWidth / 2;
        x += cc.subtreeWidth + SUBTREE_GAP;
        queue.push(cc);
      });
    }

    // Position SOLO LEAF children
    const soloIds = couple.children.filter(pid => !personCouple[pid]);
    if (soloIds.length > 0) {
      const totalW = soloIds.length * NODE_W + (soloIds.length - 1) * SUBTREE_GAP;
      let x = couple.cx - totalW / 2;
      soloIds.forEach(pid => {
        const p = personMap[pid];
        p.soloX  = x;
        p.soloY  = (couple.gen + 1) * ROW_HEIGHT + PADDING;
        p.soloCX = x + NODE_W / 2;
        x += NODE_W + SUBTREE_GAP;
      });
    }
  }
}
```

**Output per couple:**
- `cx` — horizontal center of the couple pair
- `y` — top edge of the row
- `yBot` — bottom edge of the row (`y + NODE_H`)
- `spouseAX` — left edge of spouseA card
- `spouseBX` — left edge of spouseB card

**Output per solo leaf person:**
- `soloX`, `soloY` — top-left of the card
- `soloCX` — horizontal center (for connector drop-line target)

---

### Phase 4 — Render (SVG)

Two layers inside a zoom group (connectors behind nodes):

```
<g class="zoom-layer">
  <g class="connectors">   ← lines rendered first (behind)
  <g class="nodes">        ← cards rendered on top
```

**Connector geometry for each couple:**
1. Horizontal spouse bar: right edge of spouseA card → left edge of spouseB card, at `y + NODE_H/2`
2. Vertical drop: from couple `cx` downward to `midY = yBot + VERTICAL_GAP/2`
3. Horizontal child bar: from leftmost to rightmost child card-center, at `midY` (skip if only 1 child; draw an elbow if the single child is offset from parent cx)
4. Vertical drops: from `midY` down to the **top of each child's own card** at that card's horizontal center

**Critical:** Drop lines target the **bloodline child's card center**, not the couple unit's midpoint (`cx`). The child appears as `spouseA` of their couple, so the target x is `cc.spouseAX + NODE_W / 2`. If the child is somehow `spouseB`, use `cc.spouseBX + NODE_W / 2`. This distinction matters because `cc.cx` (midpoint between the two spouse cards) is offset from the child's own card center by half a card width plus half the gap.

```js
const childIsSpouseA = couple.children.includes(cc.spouseA);
const childCardCX = childIsSpouseA
  ? cc.spouseAX + NODE_W / 2
  : cc.spouseBX + NODE_W / 2;
```

**SVG canvas sizing:**
- Width = `root.subtreeWidth + PADDING * 2`
- Height = `(maxGen + 1) * ROW_HEIGHT + PADDING * 2` (dynamic, not hardcoded)

**Zoom:** D3's `d3.zoom()` with `scaleExtent([0.2, 3])`. Initial transform fits the full tree in the viewport. Zoom state is saved across re-renders by reading `d3.zoomTransform(svg.node())` before clearing and reapplying it after.

---

## 4. API Design

All routes prefixed `/api`. No authentication in prototype. JSON responses throughout (except `PUT /api/people/:id` which accepts `multipart/form-data`).

### `GET /api/tree`

Returns the full tree. Root couple is always `couples[0]`.

```json
{
  "people": [
    { "id": "...", "name": "Arthur Smith", "birth": 1910, "death": 1985, "gender": "M", "profilePicture": null }
  ],
  "couples": [
    { "id": "...", "spouseA": "...", "spouseB": "...", "children": ["...", "..."] }
  ]
}
```

`couples[].children` is a flat array of person ID strings, sorted by `sortOrder`.

---

### `POST /api/couples`

Creates a new couple: existing bloodline person + new spouse.

**Body:**
```json
{
  "existingPersonId": "...",
  "spouse": { "name": "Jane Doe", "birth": 1990, "death": null, "gender": "F" }
}
```

- `existingPersonId` always becomes `spouseA`.
- Runs in a single Prisma transaction: create spouse person → create couple.
- Returns `201` with `{ id, spouseAId, spouseBId }`.
- Errors: `409` if person already in a couple, `404` if person not found, `400` on invalid spouse fields.

---

### `POST /api/couples/:id/children`

Adds a child to an existing couple.

**Body:**
```json
{ "name": "Ben Smith", "birth": 2015, "death": null, "gender": "M" }
```

- `sortOrder` = current child count for the couple (appends to end).
- Returns `201` with the created person object.
- Errors: `404` if couple not found, `400` on invalid fields.

---

### `DELETE /api/people/:id`

Removes a person. Asymmetric deletion logic:

| Case | Behavior |
|------|----------|
| Person has no couple | Delete the person |
| Person is `spouseB` (married-in) | Delete person; dissolve couple; `spouseA` stays |
| Person is `spouseA` (bloodline) | Delete person + their `spouseB` (spouseB would be orphaned) |
| Person's couple has children | **Reject with `409`** — must remove descendants first |

**Transaction order (prevents FK violations):**
1. Find person (404 if missing)
2. Find couple if any
3. If couple has CoupleChild rows → return 409
4. If person is spouseA: remove spouseB from any CoupleChild row, then delete spouseB Person
5. Delete Couple row (cascade deletes its CoupleChild rows)
6. Delete CoupleChild row where `childId = person.id` (remove from parent's children list)
7. Delete target Person row

Returns `200 { "deleted": ["id1"] }` or `200 { "deleted": ["id1", "id2"] }` (spouseA + spouseB case).

---

### `PUT /api/people/:id`

Updates person details and/or profile picture. Accepts `multipart/form-data`.

**Fields:** `name`, `birth` (string), `death` (string or empty), `gender`, `profilePicture` (file, optional), `removePhoto` ("true", optional)

- `removePhoto=true` wins over any uploaded file — deletes existing photo, ignores new file.
- **Safe photo replacement order:** write new file → update DB → delete old file. If DB fails after write, delete new file and return error; old file untouched.
- File constraints: max 2 MB, accepted MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`. MIME type from file buffer (not extension). UUID-based filename, never client filename.
- Returns updated Person object (all fields).
- Errors: `404` if not found, `400` on validation failure or bad file.

---

### `GET /api/relationship?a=<personId>&b=<personId>`

Finds the shortest relationship path between two people.

**Graph construction:** Build undirected adjacency:
- person ↔ their spouse (via couple)
- person ↔ their children (via CoupleChild)
- child ↔ their parents

Run BFS from `a` to `b`.

**Response `200`:**
```json
{
  "path": ["id1", "id2", "id3"],
  "people": [...],
  "couples": [...]
}
```
- `path` — ordered person IDs from A to B
- `people` — all people needed to render the subtree (path nodes + their spouses)
- `couples` — couples where at least one spouse is in `path`, plus those spouses

- `400` — missing/invalid `a` or `b`
- `404` — no path exists (disconnected)

---

### Internal: `createPerson(data, tx)`

Shared module function (not an HTTP route) for creating a person inside a transaction. Validates all fields and throws a tagged 400 error if invalid. Called by `POST /api/couples` and `POST /api/couples/:id/children`. **Not exposed as an HTTP endpoint** — orphaned persons (no couple, no parent) cannot be displayed in the tree.

---

### Error Response Format

```json
{ "error": "Human-readable message" }
```

| Prisma error | HTTP status |
|--------------|-------------|
| `P2002` unique constraint | `409` |
| `P2025` record not found | `404` |
| Other | `500` |

---

## 5. UI Patterns

### Person Card (SVG `<g.person>`)

| Element | Position / Style |
|---------|-----------------|
| Background rect | `width=NODE_W, height=NODE_H, rx=8`, fill/stroke per gender |
| Avatar circle | `cx=22, cy=30, r=18`, filled per gender |
| Profile photo (if set) | SVG `<image>` clipped to avatar circle via `<clipPath id="avatar-clip-{id}">`. Colored circle still rendered beneath as fallback. |
| Initial letter (no photo) | Centered in avatar, `font-size=15px, font-weight=700, fill=#fff` |
| Name text | `x=46, y=21` (1-line) or `y=16/29` (2-line). Font 12px/600. Truncated with `…` if overflow. |
| Years text | `x=46, y=39` (1-line) or `y=44` (2-line). Format: `"1910–1985"` or `"b. 1910"` |
| Tooltip | `<title>` child element with full name — native browser tooltip |

**Gender color scheme:**

| | Male | Female |
|-|------|--------|
| Card fill | `#1e3a5f` | `#3d1f2e` |
| Card stroke | `#2a5fa0` | `#a04a6a` |
| Avatar fill | `#2a5fa0` | `#a04a6a` |
| Years text | `#aac8f0` | `#f0c0d0` |

**Long name handling:**
- Available text width: ~70px (from x=46 to x=116)
- Estimated char width: 7px (conservative, avoids `<canvas>` dependency)
- If name fits 1 line: `y=21`, years `y=39`
- If 2 lines needed: line1 `y=16`, line2 `y=29`, years `y=44`
- Line 2 truncated to fit, with `…` appended

### Context Menu

`<div id="ctx-menu">` positioned with `position:fixed` near the clicked card. Items:

| Button | Enabled when |
|--------|-------------|
| Edit | Always |
| Find Relationship To… | Always |
| Add Spouse | Person has no couple |
| Add Child | Person belongs to a couple |
| Remove | Person has no couple, OR couple has no children |

"Add Child" shown disabled with tooltip "Add a spouse first" if person has no couple.
"Remove" shown disabled with tooltip "Cannot remove a person with children" if couple has children.

**Remove confirmation flow:** Context menu transitions inline to a confirmation state. Message varies by case (solo person / dissolve couple / also removes spouse). Loading indicator replaces buttons during in-flight DELETE. Error shown inline on failure.

### Modal Form

Single `<div id="modal-overlay">` reused for "Add Spouse", "Add Child", and "Edit Person" modes.

**Fields:**

| Field | Type | Validation |
|-------|------|------------|
| Photo (edit mode only) | Clickable circle → file input | image/*, max 2 MB, live preview |
| Name | text | required, non-empty |
| Birth year | number | required, 1000–2100 |
| Death year | number | optional, ≥ birth |
| Gender | M/F radio | required |

**Modal close behavior:** Only closes on X button click or successful submit. Outside click does **not** close the modal (deliberate — prevents accidental data loss).

**Photo UX state:** `removePhoto` flag overrides any new file selection. Clicking "Remove photo" sets the flag and clears the preview.

### Data Re-fetch Pattern

After every successful mutation, the frontend calls `init()` to re-fetch `/api/tree` and re-render from scratch. Zoom state is preserved by saving `d3.zoomTransform(svg.node())` before clearing and reapplying after render.

---

## 6. Features Implemented

| Feature | Notes |
|---------|-------|
| Tree visualization | Top-down, couple-centric, 5-generation sample data |
| Add spouse | Right-click → "Add Spouse" → modal → POST /api/couples |
| Add child | Right-click → "Add Child" → modal → POST /api/couples/:id/children |
| Remove person | Right-click → "Remove" → inline confirm → DELETE /api/people/:id |
| Edit person | Right-click → "Edit" → pre-filled modal → PUT /api/people/:id |
| Profile picture | Upload in edit modal; multer + disk storage; UUID filename |
| Relationship finder | Separate `relationship.html` page; GET /api/relationship BFS; path highlighted in gold |
| Pre-fill relationship page | Right-click → "Find Relationship To…" → navigates with `?a=<id>` |
| Type-ahead search | Name inputs on relationship page with live-filtered dropdown |
| Long name truncation | 2-line wrapping with `…` truncation; native tooltip shows full name |
| Modal X button | Replaces outside-click-to-close |
| Zoom/pan | D3 zoom, `scaleExtent([0.2, 3])`, fit-on-load, state preserved across re-renders |

---

## 7. Visual Design

**Theme:** Dark (`#0f1117` background, `#ffffff` text, blue/rose gender accents)

**Relationship page visual distinction:**

| Node | Style |
|------|-------|
| On the path (or spouse of a through-couple — see rule below) | Normal card + gold stroke `#f0c040`, `stroke-width: 2.5`, full opacity |
| De-emphasized spouse | 45% opacity, dashed border, gender-colored stroke |
| Connectors between highlighted nodes | Solid, `#ffffff`, `stroke-width: 2` |
| Connectors to de-emphasized nodes | Dashed `stroke-dasharray: 4,3`, `#555`, `stroke-width: 1.5` |

**Spouse highlighting rule:** After the BFS path is computed, expand the highlight set using this logic:
- If a couple has **at least one child in the path** (path passes *through* them downward), add **both spouses** to the highlight set — both parents are equally responsible for the connecting child.
- If the path merely **terminates at** one spouse (they are a leaf in the path), only that spouse is highlighted; their partner stays de-emphasized.

```js
couples.forEach(c => {
  if (c.children.length > 0) {   // c.children is pre-filtered to path members by the API
    pathSet.add(c.spouseA);
    pathSet.add(c.spouseB);
  }
});
```

**Connector lines (main tree):** stroke `#aaaaaa`, stroke-width 1.5

---

## 8. Design Decisions & Rationale

### Couples as first-class entities
A person-centric model (parent/child links only) cannot cleanly represent marriages or compute correct horizontal positioning for spouse pairs. Making `Couple` a first-class DB table solves both.

### spouseA = bloodline, spouseB = married-in
This asymmetry drives two things: (1) the deletion logic — deleting spouseA must also delete spouseB (who has no other place in the tree), but deleting spouseB leaves spouseA as an uncoupled bloodline node; (2) connector drop targets — parent-to-child drop lines must land on the **child's own card center** (`spouseAX + NODE_W/2`), not the couple unit midpoint (`cx`). Using `cx` would land the connector in the gap between the two spouse cards rather than on the child.

### Relationship finder connector drops use card center, not couple cx
The same card-center drop logic that applies to the main tree must also be applied to `relationship.html`. A common mistake is to use `cc.cx` (couple midpoint) for the drop target in the filtered subtree — this places connectors visually between two spouse cards instead of on the bloodline child's card.

### Full re-render instead of incremental DOM updates
Re-fetching `/api/tree` and re-running the full layout + render after every mutation is ~10ms on this dataset. This is dramatically simpler than tracking dirty state or diffing SVG elements. Production apps with thousands of nodes may need to reconsider this.

### No exposed `POST /api/people` endpoint
Orphaned persons (no couple, no parent) cannot be rendered in the tree. Preventing creation via the API keeps the data consistent. Person creation is always bundled with a couple or child creation in a transaction.

### Root couple identification via server-side detection
The root couple is the one whose both spouses have no `CoupleChild` row. This is computed at `GET /api/tree` time, ensuring `couples[0]` is always correct regardless of insertion order.

### Profile picture safe-replace order
Write new file → update DB → delete old file. This order ensures no data loss: if the DB commit fails, the new file is cleaned up and the old file is untouched. The reverse order (delete old first) risks losing both.

### No canvas/measureText for name wrapping
SVG has no native `measureText`. Using a character width estimate (7px at 12px/600 font) avoids a hidden `<canvas>` dependency while being conservative enough to prevent clipping (it errs toward wrapping early).

---

## 9. Known Gaps / Deferred Work

| Area | Gap |
|------|-----|
| Auth | No authentication/authorization |
| Remarriage | A person cannot belong to two couples (DB enforced with `@unique`). Divorce + remarriage is not modeled. |
| Multiple spouses | Same constraint — one couple per person. |
| Removing a person with children | Must remove all descendants first (UI prevents this, not a limitation to fix now) |
| Relationship labels | BFS finds path but does not compute labels like "grandfather" or "2nd cousin" |
| EXIF stripping | Uploaded profile photos may contain GPS metadata — conscious deferral |
| Image resizing | Photos stored at original size. No server-side cropping/resizing. |
| Multi-user sync | Single-user, no real-time collaboration |
| Birth order editing | `sortOrder` is set at insert time (append-only). No UI to reorder siblings. |
| Search/filter on main tree | No search; the relationship finder page is the only navigation aid |
| Non-binary / other gender | Only "M"/"F" supported. The gender field drives card color only. |
| Adoption / step-parents | Not modeled — all `CoupleChild` links represent biological/primary parentage |
| Large tree performance | No pagination, lazy loading, or virtualization. Fine for prototype scale. |
| Photo CDN | Photos stored on local disk. No CDN or object store. |

---

## 10. Adaptation Notes for the Production App

These are the key architectural shifts when building the production multi-platform app:

### Backend (shared API)

- **Add authentication.** Every endpoint needs auth. Consider JWT or session-based auth. The relationship between users and family trees (one user owns a tree? multiple users share a tree?) needs to be designed.
- **Namespace trees.** The prototype is a single global tree. Production needs a `FamilyTree` model that owns the people and couples (multi-tenancy).
- **`GET /api/tree` will not scale.** Returning the entire tree on every mutation works for 38 people. For large trees, consider: paginated subtree fetch, fetch-by-generation, or a GraphQL-style selective fetch.
- **The relationship BFS endpoint is production-ready.** The backend graph traversal approach (not client-side) is the right call for reuse across Angular/Android/iOS.
- **`PUT /api/people/:id` multipart approach works for web.** Mobile apps may prefer a two-step approach (upload photo separately → get URL → update person with URL).
- **File storage.** Move from `server/uploads/` local disk to S3/GCS or equivalent for multi-instance deployments.

### Data model changes to consider

- Add a `FamilyTree` model; scope `Person` and `Couple` to a tree.
- Add a `User` model with auth.
- Consider adding `relationshipType` to `CoupleChild` for adoption/step-parent modeling.
- Consider adding `marriageDate`/`divorceDate` to `Couple`.
- The `gender` field may need expanding beyond "M"/"F" depending on requirements.

### Tree layout algorithm (Angular / web)

- The 4-phase algorithm is **framework-agnostic** — it is pure math operating on plain JS objects. Port it directly to TypeScript.
- For Angular, wrap the D3 rendering in a component using `ElementRef` and `ngAfterViewInit`. The layout phases are pure functions with no DOM dependency.
- The layout constants (`NODE_W`, `NODE_H`, etc.) will likely need to change to match the new brand identity.

### Tree layout algorithm (Android / iOS)

- The **3 layout phases** (generation assignment, subtree widths, x/y positions) are pure data transforms — port them to Kotlin/Swift as standalone functions.
- The **render phase** (phase 4) will be replaced by native drawing (Android Canvas/Jetpack Compose, iOS Core Graphics/SwiftUI).
- The connector geometry (spouse bar, midY drop, horizontal child bar, child drops) can be translated directly to native path drawing.

### Relationship finder (mobile)

- The API is already client-agnostic. Mobile apps call `GET /api/relationship?a=&b=` the same way.
- The path highlighting logic (gold stroke on path nodes, dashed connectors to de-emphasized nodes) needs to be reimplemented in native UI.

### Brand identity

- **Colors:** Replace `#1e3a5f` (male card fill), `#3d1f2e` (female card fill), `#0f1117` (background) with your brand palette. These are concentrated in the color constants object `C` — one place to change.
- **Typography:** Replace `system-ui, sans-serif` with your brand font.
- **Card shape:** `rx=8` for rounded corners; adjust to match your design system.
- **Avatar style:** Currently initials in a circle. May want profile photo only (no initials fallback circle if brand doesn't suit it).
