# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands that operate inside `server/` must be run with an explicit path rather than a `cd` first. Use `--prefix` for npm and `--cwd` / `-C` flags where available to avoid shell `cd` and the permission prompts it can trigger on Windows.

**Start the backend server:**
```bash
node server/src/index.js
# Runs on port 5001 (configured in server/.env)
```

**Run tests (backend only — all tests are in server/):**
```bash
npm --prefix server test
# Runs Jest with --runInBand (serial) and --forceExit
```

**Run a single test file:**
```bash
npm --prefix server exec -- jest __tests__/couples.test.js
```

**Seed the database:**
```bash
npm --prefix server run seed
# Inserts 38 people and 15 couples across 5 generations
```

**Run Prisma migrations:**
```bash
npm --prefix server exec -- prisma migrate dev
```

**Regenerate Prisma client after schema changes:**
```bash
npm --prefix server exec -- prisma generate
```

**Git commands:**
Always use `git -C <absolute-path>` instead of `cd <path> && git ...` to avoid permission prompts:
```bash
git -C /absolute/path/to/family-tree status
git -C /absolute/path/to/family-tree log --oneline
```

## Architecture

This is a **full-stack app** with no build step on the frontend.

- **Frontend**: `index.html` — a single HTML file (~650 lines) using D3.js v7 (CDN) and vanilla JavaScript. No framework, no bundler.
- **Backend**: `server/` — Express.js REST API backed by PostgreSQL via Prisma ORM.
- **Database**: PostgreSQL. Connection string in `server/.env` as `DATABASE_URL`. Port 5001.

### Data Model (Prisma)

Three models in `server/prisma/schema.prisma`:
- **Person** — `id` (cuid), `name`, `birth` (int), `death` (int, optional), `gender` ("M"/"F"), `profilePicture` (String, optional — relative URL e.g. `/uploads/<uuid>.png`)
- **Couple** — links two `Person` records via `spouseAId` (unique) and `spouseBId` (unique). One couple per person maximum.
- **CoupleChild** — junction table linking a `Couple` to its child `Person`s, with `sortOrder` for birth order. Cascade-deletes when a couple is removed.

### API Routes (`server/src/routes/`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tree` | Returns `{ people[], couples[] }` — full tree data |
| POST | `/api/couples` | Create couple: existing person + new spouse |
| POST | `/api/couples/:id/children` | Add a child to a couple |
| DELETE | `/api/people/:id` | Delete person (cascades to couple and children) |
| PUT | `/api/people/:id` | Update person fields + optional profile picture (multipart/form-data) |

After any mutation, the frontend calls `init()` to re-fetch the full tree and re-render from scratch. No incremental updates.

### Frontend Layout Pipeline

The frontend renders a family tree SVG using a 4-phase algorithm in `index.html`:

1. **`assignGenerations()`** — BFS from the root couple (`c1`) to assign `gen` values to each couple.
2. **`computeSubtreeWidths()`** — Bottom-up pass to compute `subtreeWidth` for each couple (space needed by all descendants).
3. **`computePositions()`** — Top-down BFS to assign `cx` (couple center x), `y`, spouse card positions (`spouseAX`, `spouseBX`), and solo child positions (`soloX`, `soloY`, `soloCX`).
4. **Render** — D3 data binding creates SVG `<g>` elements for person cards and connector lines (spouse bars, vertical drops, horizontal child bars).

Layout constants: `NODE_W=120`, `NODE_H=60`, `SPOUSE_GAP=12`, `SUBTREE_GAP=48`, `ROW_HEIGHT=120`.

Color scheme: males use blue tones (`#1e3a5f` fill), females use pink tones (`#3d1f2e` fill).

### Frontend UI Interactions

- **Right-click** on a person card → context menu (Edit, Add Spouse, Add Child, Remove)
- **Modal form** for new person details (name, birth, death, gender) and for editing existing persons (pre-filled, includes profile photo upload/removal)
- **D3 zoom/pan** with `scaleExtent: [0.2, 3]`; zoom state is preserved across re-renders

### Testing

Tests live in `server/__tests__/`. Each route has its own test file (`tree.test.js`, `couples.test.js`, `people.test.js`). `helpers.js` provides `clearDatabase()` and the shared Prisma client. Tests hit a real PostgreSQL database — no mocks.
