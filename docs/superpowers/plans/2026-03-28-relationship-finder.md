# Relationship Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /api/relationship` backend endpoint and a `relationship.html` frontend page that lets users select two people and see a filtered subtree visualization of the path connecting them.

**Architecture:** The backend builds an undirected adjacency graph from all couples/children and runs BFS to find the shortest person-to-person path, then returns the relevant subgraph. The frontend reuses the exact same 4-phase D3 layout pipeline from `index.html`, rendering path nodes in gold and non-path spouse nodes at reduced opacity with dashed borders.

**Tech Stack:** Node.js/Express, Prisma/PostgreSQL, Vanilla JS, D3.js v7 (CDN), Supertest (tests)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `server/src/routes/relationship.js` | Create | `GET /api/relationship` — BFS path finding + response shaping |
| `server/__tests__/relationship.test.js` | Create | Backend tests for path finding and all error cases |
| `server/src/index.js` | Modify | Register `/api/relationship` route |
| `relationship.html` | Create | Search inputs + D3 subtree rendering |
| `index.html` | Modify | Add "Find Relationship To…" context menu item |

---

### Task 1: Backend — relationship route (TDD)

**Files:**
- Create: `server/__tests__/relationship.test.js`
- Create: `server/src/routes/relationship.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/relationship.test.js`:

```js
const request = require('supertest');
const app = require('../src/index');
const { prisma, clearDatabase } = require('./helpers');

beforeEach(clearDatabase);
afterAll(() => prisma.$disconnect());

// ── Helper: two-generation family ────────────────────────────────
// grandpa+grandma → dad; dad+mom → child
async function makeFamily() {
  const grandpa = await prisma.person.create({ data: { name: 'Grandpa', birth: 1920, gender: 'M' } });
  const grandma = await prisma.person.create({ data: { name: 'Grandma', birth: 1922, gender: 'F' } });
  const couple1 = await prisma.couple.create({ data: { spouseAId: grandpa.id, spouseBId: grandma.id } });
  const dad = await prisma.person.create({ data: { name: 'Dad', birth: 1950, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple1.id, childId: dad.id, sortOrder: 0 } });
  const mom = await prisma.person.create({ data: { name: 'Mom', birth: 1952, gender: 'F' } });
  const couple2 = await prisma.couple.create({ data: { spouseAId: dad.id, spouseBId: mom.id } });
  const child = await prisma.person.create({ data: { name: 'Child', birth: 1975, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple2.id, childId: child.id, sortOrder: 0 } });
  return { grandpa, grandma, couple1, dad, mom, couple2, child };
}

// ── Helper: cousin family ────────────────────────────────────────
// grandpa+grandma → [dad, uncle]
// dad+mom → cousin1;  uncle+aunt → cousin2
async function makeCousins() {
  const grandpa = await prisma.person.create({ data: { name: 'Grandpa', birth: 1920, gender: 'M' } });
  const grandma = await prisma.person.create({ data: { name: 'Grandma', birth: 1922, gender: 'F' } });
  const couple1 = await prisma.couple.create({ data: { spouseAId: grandpa.id, spouseBId: grandma.id } });
  const dad = await prisma.person.create({ data: { name: 'Dad', birth: 1950, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple1.id, childId: dad.id, sortOrder: 0 } });
  const uncle = await prisma.person.create({ data: { name: 'Uncle', birth: 1952, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple1.id, childId: uncle.id, sortOrder: 1 } });
  const mom = await prisma.person.create({ data: { name: 'Mom', birth: 1953, gender: 'F' } });
  const couple2 = await prisma.couple.create({ data: { spouseAId: dad.id, spouseBId: mom.id } });
  const aunt = await prisma.person.create({ data: { name: 'Aunt', birth: 1955, gender: 'F' } });
  const couple3 = await prisma.couple.create({ data: { spouseAId: uncle.id, spouseBId: aunt.id } });
  const cousin1 = await prisma.person.create({ data: { name: 'Cousin1', birth: 1978, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple2.id, childId: cousin1.id, sortOrder: 0 } });
  const cousin2 = await prisma.person.create({ data: { name: 'Cousin2', birth: 1980, gender: 'F' } });
  await prisma.coupleChild.create({ data: { coupleId: couple3.id, childId: cousin2.id, sortOrder: 0 } });
  return { grandpa, grandma, couple1, dad, uncle, mom, couple2, aunt, couple3, cousin1, cousin2 };
}

// ── GET /api/relationship ─────────────────────────────────────────
describe('GET /api/relationship', () => {
  test('returns 400 when a param is missing', async () => {
    const { grandpa } = await makeFamily();
    const res = await request(app).get(`/api/relationship?b=${grandpa.id}`);
    expect(res.status).toBe(400);
  });

  test('returns 400 when b param is missing', async () => {
    const { grandpa } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}`);
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid person ID', async () => {
    const { grandpa } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=does-not-exist`);
    expect(res.status).toBe(400);
  });

  test('returns 400 when a and b are the same person', async () => {
    const { grandpa } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=${grandpa.id}`);
    expect(res.status).toBe(400);
  });

  test('returns direct path between parent and child', async () => {
    const { grandpa, dad } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=${dad.id}`);
    expect(res.status).toBe(200);
    expect(res.body.path).toEqual([grandpa.id, dad.id]);
  });

  test('returns 3-node path for grandparent and grandchild', async () => {
    const { grandpa, child } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=${child.id}`);
    expect(res.status).toBe(200);
    expect(res.body.path[0]).toBe(grandpa.id);
    expect(res.body.path[res.body.path.length - 1]).toBe(child.id);
    expect(res.body.path.length).toBe(3);
  });

  test('returns 5-node path for first cousins', async () => {
    const { cousin1, cousin2 } = await makeCousins();
    const res = await request(app).get(`/api/relationship?a=${cousin1.id}&b=${cousin2.id}`);
    expect(res.status).toBe(200);
    expect(res.body.path[0]).toBe(cousin1.id);
    expect(res.body.path[res.body.path.length - 1]).toBe(cousin2.id);
    expect(res.body.path.length).toBe(5);
  });

  test('response people includes spouses of path nodes (not only path nodes)', async () => {
    const { grandpa, grandma, dad } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=${dad.id}`);
    expect(res.status).toBe(200);
    const personIds = res.body.people.map(p => p.id);
    // grandpa is on path; grandma is his spouse — must be in people for rendering
    expect(personIds).toContain(grandma.id);
  });

  test('returns 404 when no path exists between disconnected people', async () => {
    const alice = await prisma.person.create({ data: { name: 'Alice', birth: 1970, gender: 'F' } });
    const bob   = await prisma.person.create({ data: { name: 'Bob',   birth: 1972, gender: 'M' } });
    const res = await request(app).get(`/api/relationship?a=${alice.id}&b=${bob.id}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
npm --prefix server exec -- jest __tests__/relationship.test.js --verbose
```

Expected: all 9 tests fail with `expected 400/200 received 404` (route does not exist yet).

- [ ] **Step 3: Create `server/src/routes/relationship.js`**

```js
const { Router } = require('express');
const prisma = require('../lib/prisma');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { a, b } = req.query;

    if (!a || !b) {
      return res.status(400).json({ error: 'Both a and b query params are required.' });
    }
    if (a === b) {
      return res.status(400).json({ error: 'a and b must be different people.' });
    }

    const [personA, personB] = await Promise.all([
      prisma.person.findUnique({ where: { id: a } }),
      prisma.person.findUnique({ where: { id: b } }),
    ]);

    if (!personA) return res.status(400).json({ error: 'Person a not found.' });
    if (!personB) return res.status(400).json({ error: 'Person b not found.' });

    const [allPeople, allCouples] = await Promise.all([
      prisma.person.findMany(),
      prisma.couple.findMany({ include: { children: { orderBy: { sortOrder: 'asc' } } } }),
    ]);

    // Build undirected adjacency list: person ↔ spouse, person ↔ parent, person ↔ child
    const adj = new Map();
    allPeople.forEach(p => adj.set(p.id, []));
    allCouples.forEach(({ spouseAId, spouseBId, children }) => {
      adj.get(spouseAId).push(spouseBId);
      adj.get(spouseBId).push(spouseAId);
      children.forEach(({ childId }) => {
        adj.get(spouseAId).push(childId);
        adj.get(spouseBId).push(childId);
        adj.get(childId).push(spouseAId);
        adj.get(childId).push(spouseBId);
      });
    });

    // BFS from a → b, tracking predecessors
    const prev = new Map([[a, null]]);
    const queue = [a];
    let found = false;

    outer: while (queue.length) {
      const curr = queue.shift();
      for (const neighbor of (adj.get(curr) || [])) {
        if (!prev.has(neighbor)) {
          prev.set(neighbor, curr);
          if (neighbor === b) { found = true; break outer; }
          queue.push(neighbor);
        }
      }
    }

    if (!found) {
      return res.status(404).json({ error: 'No relationship found between these two people.' });
    }

    // Reconstruct path
    const path = [];
    let curr = b;
    while (curr !== null) {
      path.unshift(curr);
      curr = prev.get(curr);
    }

    const pathSet = new Set(path);

    // Couples where at least one spouse is on the path
    const includedCouples = allCouples.filter(
      c => pathSet.has(c.spouseAId) || pathSet.has(c.spouseBId)
    );

    // Root = the included couple whose spouses don't appear as children in any included couple
    const includedChildIds = new Set(
      includedCouples.flatMap(c => c.children.map(cc => cc.childId))
    );
    const rootIdx = includedCouples.findIndex(
      c => !includedChildIds.has(c.spouseAId) && !includedChildIds.has(c.spouseBId)
    );
    const sortedCouples = rootIdx > 0
      ? [includedCouples[rootIdx], ...includedCouples.filter((_, i) => i !== rootIdx)]
      : includedCouples;

    // Format couples: children filtered to path members only
    const couples = sortedCouples.map(c => ({
      id: c.id,
      spouseA: c.spouseAId,
      spouseB: c.spouseBId,
      children: c.children.map(cc => cc.childId).filter(id => pathSet.has(id)),
    }));

    // People: all spouses from included couples + any path members not covered (solo leaf nodes)
    const includedPersonIds = new Set();
    includedCouples.forEach(c => {
      includedPersonIds.add(c.spouseAId);
      includedPersonIds.add(c.spouseBId);
    });
    path.forEach(id => includedPersonIds.add(id));

    const people = allPeople.filter(p => includedPersonIds.has(p.id));

    res.json({ path, people, couples });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Register the route in `server/src/index.js`**

In `server/src/index.js`, add the new route after the existing three:

```js
app.use('/api', require('./routes/tree'));
app.use('/api/couples', require('./routes/couples'));
app.use('/api/people', require('./routes/people'));
app.use('/api/relationship', require('./routes/relationship'));  // ← add this line
```

- [ ] **Step 5: Run tests — verify all 9 pass**

```bash
npm --prefix server exec -- jest __tests__/relationship.test.js --verbose
```

Expected: `✓` next to all 9 tests.

- [ ] **Step 6: Run full suite — verify nothing regressed**

```bash
npm --prefix server test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git -C C:/Users/ACER/Projects/claude/family-tree add server/src/routes/relationship.js server/__tests__/relationship.test.js server/src/index.js
git -C C:/Users/ACER/Projects/claude/family-tree commit -m "feat: add GET /api/relationship endpoint with BFS path finding"
```

---

### Task 2: Frontend — `relationship.html`

**Files:**
- Create: `relationship.html`

- [ ] **Step 1: Create `relationship.html`**

Create at the project root (same directory as `index.html`):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relationship Finder — Family Tree</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      width: 100%; height: 100%;
      display: flex; flex-direction: column; overflow: hidden;
      background: #0f1117; color: #fff;
      font-family: system-ui, sans-serif;
    }

    /* ── Top bar ── */
    #topbar {
      flex-shrink: 0; height: 56px;
      background: #1a1d27; border-bottom: 1px solid #333;
      display: flex; align-items: center; padding: 0 20px; gap: 16px;
    }
    #back-link { color: #aac8f0; font-size: 13px; text-decoration: none; white-space: nowrap; }
    #back-link:hover { color: #fff; }
    #topbar-title { flex: 1; text-align: center; font-size: 15px; font-weight: 600; }
    .topbar-spacer { width: 100px; } /* mirrors back-link area to keep title centered */

    /* ── Search row ── */
    #search-row {
      flex-shrink: 0;
      background: #1a1d27; border-bottom: 1px solid #333;
      padding: 12px 20px; display: flex; flex-direction: column; gap: 8px;
    }
    #search-inputs { display: flex; gap: 12px; align-items: flex-end; }
    .picker { position: relative; flex: 1; }
    .picker label { display: block; font-size: 11px; color: #888; margin-bottom: 5px; }
    .picker input {
      width: 100%; padding: 7px 10px;
      background: #0f1117; border: 1px solid #444; border-radius: 6px;
      color: #fff; font: 14px system-ui, sans-serif;
    }
    .picker input:focus { outline: none; border-color: #2a5fa0; }
    .picker input.has-selection { border-color: #2a5fa0; }
    .dropdown {
      display: none; position: absolute; top: calc(100% + 4px); left: 0; right: 0;
      background: #1a1d27; border: 1px solid #444; border-radius: 6px;
      max-height: 200px; overflow-y: auto; z-index: 100;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    }
    .dropdown.open { display: block; }
    .dropdown-item { padding: 8px 12px; cursor: pointer; font-size: 13px; }
    .dropdown-item:hover, .dropdown-item.active { background: #2a2d3a; }
    .dropdown-item.no-results { color: #666; cursor: default; }

    #find-btn {
      padding: 8px 20px; background: #2a5fa0; color: #fff;
      border: none; border-radius: 6px; font: 14px system-ui, sans-serif;
      cursor: pointer; white-space: nowrap;
    }
    #find-btn:hover:not(:disabled) { background: #3370b8; }
    #find-btn:disabled { background: #333; color: #666; cursor: default; }

    #search-error { font-size: 12px; color: #f08080; display: none; }
    #search-error.visible { display: block; }

    /* ── Canvas ── */
    #canvas-wrap { flex: 1; position: relative; overflow: hidden; }
    svg#rel-tree { display: block; width: 100%; height: 100%; cursor: grab; }
    svg#rel-tree:active { cursor: grabbing; }
    #canvas-msg {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      color: #555; font-size: 15px; pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="topbar">
    <a href="/" id="back-link">← Back to Tree</a>
    <div id="topbar-title">Relationship Finder</div>
    <div class="topbar-spacer"></div>
  </div>

  <div id="search-row">
    <div id="search-inputs">
      <div class="picker">
        <label for="input-a">Person A</label>
        <input type="text" id="input-a" placeholder="Type a name…" autocomplete="off">
        <div class="dropdown" id="dropdown-a"></div>
      </div>
      <div class="picker">
        <label for="input-b">Person B</label>
        <input type="text" id="input-b" placeholder="Type a name…" autocomplete="off">
        <div class="dropdown" id="dropdown-b"></div>
      </div>
      <button id="find-btn" disabled>Find</button>
    </div>
    <div id="search-error"></div>
  </div>

  <div id="canvas-wrap">
    <svg id="rel-tree"></svg>
    <div id="canvas-msg">Select two people above to see their relationship.</div>
  </div>

  <script>
    // ===== LAYOUT CONSTANTS (identical to index.html) =====
    const NODE_W      = 120;
    const NODE_H      = 60;
    const SPOUSE_GAP  = 12;
    const SUBTREE_GAP = 48;
    const ROW_HEIGHT  = 120;
    const VERTICAL_GAP = 60;
    const PADDING     = 40;

    const C = {
      M: { fill: '#1e3a5f', stroke: '#2a5fa0', avatar: '#2a5fa0', years: '#aac8f0' },
      F: { fill: '#3d1f2e', stroke: '#a04a6a', avatar: '#a04a6a', years: '#f0c0d0' },
    };

    // ===== STATE =====
    let allPeople    = [];
    let selectedA    = null;   // { id, name, ... }
    let selectedB    = null;
    let pathSet      = new Set();

    let people       = [];
    let couples      = [];
    let personMap    = {};
    let personCouple = {};

    // ===== 4-PHASE LAYOUT (copied from index.html) =====
    function assignGenerations() {
      couples[0].gen = 0;
      const queue = [couples[0]];
      while (queue.length) {
        const couple = queue.shift();
        couple.children.forEach(childId => {
          const cc = personCouple[childId];
          if (cc && cc.gen === undefined) { cc.gen = couple.gen + 1; queue.push(cc); }
        });
      }
    }

    function computeSubtreeWidths() {
      const COUPLE_W = NODE_W * 2 + SPOUSE_GAP;
      const maxGen = Math.max(...couples.map(c => c.gen));
      for (let gen = maxGen; gen >= 0; gen--) {
        couples.filter(c => c.gen === gen).forEach(couple => {
          const childCouples = couple.children.map(pid => personCouple[pid]).filter(Boolean);
          const soloCount    = couple.children.filter(pid => !personCouple[pid]).length;
          const soloWidth    = soloCount > 0 ? soloCount * NODE_W + (soloCount - 1) * SUBTREE_GAP : 0;
          if (childCouples.length === 0) {
            couple.subtreeWidth = Math.max(COUPLE_W, soloWidth || COUPLE_W);
          } else {
            const coupledWidth = childCouples.reduce((s, cc) => s + cc.subtreeWidth, 0)
              + (childCouples.length - 1) * SUBTREE_GAP;
            couple.subtreeWidth = soloWidth > 0
              ? coupledWidth + SUBTREE_GAP + soloWidth
              : coupledWidth;
          }
        });
      }
    }

    function computePositions() {
      const root = couples[0];
      root.cx = root.subtreeWidth / 2 + PADDING;
      const queue = [root];
      while (queue.length) {
        const couple = queue.shift();
        couple.y    = couple.gen * ROW_HEIGHT + PADDING;
        couple.yBot = couple.y + NODE_H;
        couple.spouseAX = couple.cx - SPOUSE_GAP / 2 - NODE_W;
        couple.spouseBX = couple.cx + SPOUSE_GAP / 2;

        const childCouples = couple.children.map(pid => personCouple[pid]).filter(Boolean);
        const soloIds      = couple.children.filter(pid => !personCouple[pid]);

        if (childCouples.length > 0 || soloIds.length > 0) {
          const totalCoupledW = childCouples.length > 0
            ? childCouples.reduce((s, cc) => s + cc.subtreeWidth, 0)
              + (childCouples.length - 1) * SUBTREE_GAP
            : 0;
          const totalSoloW = soloIds.length > 0
            ? soloIds.length * NODE_W + (soloIds.length - 1) * SUBTREE_GAP : 0;
          const gap    = (childCouples.length > 0 && soloIds.length > 0) ? SUBTREE_GAP : 0;
          const totalW = totalCoupledW + gap + totalSoloW;
          let x = couple.cx - totalW / 2;

          childCouples.forEach(cc => {
            cc.cx = x + cc.subtreeWidth / 2;
            x += cc.subtreeWidth + SUBTREE_GAP;
            queue.push(cc);
          });

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

    // ===== RENDER =====
    let svg, zoomLayer, connectorLayer, nodeLayer, zoom;

    function yearsLabel(p) {
      if (!p.birth && !p.death) return '';
      if (!p.birth) return `d. ${p.death}`;
      return p.death ? `${p.birth}–${p.death}` : `b. ${p.birth}`;
    }

    function renderNodes() {
      const nodeData = [];
      couples.forEach(couple => {
        nodeData.push({ person: personMap[couple.spouseA], x: couple.spouseAX, y: couple.y });
        nodeData.push({ person: personMap[couple.spouseB], x: couple.spouseBX, y: couple.y });
      });
      people.filter(p => p.soloX !== undefined).forEach(p => {
        nodeData.push({ person: p, x: p.soloX, y: p.soloY });
      });

      const groups = nodeLayer
        .selectAll('g.person-node')
        .data(nodeData, d => d.person.id)
        .join('g')
        .attr('class', 'person-node')
        .attr('transform', d => `translate(${d.x},${d.y})`)
        .attr('opacity', d => pathSet.has(d.person.id) ? 1 : 0.45);

      groups.append('clipPath')
        .attr('id', d => `rclip-${d.person.id}`)
        .append('rect').attr('width', NODE_W).attr('height', NODE_H).attr('rx', 8);

      groups.append('clipPath')
        .attr('id', d => `raclip-${d.person.id}`)
        .append('circle').attr('cx', 22).attr('cy', NODE_H / 2).attr('r', 18);

      const inner = groups.append('g').attr('clip-path', d => `url(#rclip-${d.person.id})`);

      inner.append('rect')
        .attr('width', NODE_W).attr('height', NODE_H).attr('rx', 8)
        .attr('fill',   d => C[d.person.gender].fill)
        .attr('stroke', d => pathSet.has(d.person.id) ? '#f0c040' : C[d.person.gender].stroke)
        .attr('stroke-width',     d => pathSet.has(d.person.id) ? 2.5 : 1.5)
        .attr('stroke-dasharray', d => pathSet.has(d.person.id) ? null : '5,3');

      inner.append('circle')
        .attr('cx', 22).attr('cy', NODE_H / 2).attr('r', 18)
        .attr('fill', d => C[d.person.gender].avatar);

      inner.filter(d => !d.person.profilePicture)
        .append('text')
        .attr('x', 22).attr('y', NODE_H / 2)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('fill', '#fff').attr('font-size', '15px').attr('font-weight', '700')
        .attr('font-family', 'system-ui, sans-serif')
        .text(d => d.person.name[0]);

      inner.filter(d => !!d.person.profilePicture)
        .append('image')
        .attr('x', 4).attr('y', NODE_H / 2 - 18).attr('width', 36).attr('height', 36)
        .attr('href', d => d.person.profilePicture)
        .attr('clip-path', d => `url(#raclip-${d.person.id})`)
        .attr('preserveAspectRatio', 'xMidYMid slice');

      inner.append('text')
        .attr('x', 46).attr('y', NODE_H / 2 - 9)
        .attr('fill', '#fff').attr('font-size', '12px').attr('font-weight', '600')
        .attr('font-family', 'system-ui, sans-serif')
        .text(d => d.person.name);

      inner.append('text')
        .attr('x', 46).attr('y', NODE_H / 2 + 9)
        .attr('fill', d => C[d.person.gender].years).attr('font-size', '10px')
        .attr('font-family', 'system-ui, sans-serif')
        .text(d => yearsLabel(d.person));
    }

    function renderConnectors() {
      const lines = [];

      couples.forEach(couple => {
        const bothOnPath = pathSet.has(couple.spouseA) && pathSet.has(couple.spouseB);

        // Spouse bar
        lines.push({
          x1: couple.spouseAX + NODE_W, y1: couple.y + NODE_H / 2,
          x2: couple.spouseBX,          y2: couple.y + NODE_H / 2,
          onPath: bothOnPath,
        });

        if (couple.children.length === 0) return;

        const childCouples = couple.children.map(pid => personCouple[pid]).filter(Boolean);
        const soloIds      = couple.children.filter(pid => !personCouple[pid]);

        const allChildDests = [
          ...childCouples.map(cc => ({
            cx:     cc.cx,   // centre of the couple (between the two cards)
            y:      cc.y,
            onPath: pathSet.has(cc.spouseA) || pathSet.has(cc.spouseB),
          })),
          ...soloIds.map(pid => {
            const p = personMap[pid];
            return { cx: p.soloCX, y: p.soloY, onPath: pathSet.has(pid) };
          }),
        ];

        const yBot  = couple.yBot;
        const midY  = yBot + VERTICAL_GAP / 2;
        const cxs   = allChildDests.map(c => c.cx);
        const minCX = Math.min(...cxs);
        const maxCX = Math.max(...cxs);
        const anyChildOnPath = allChildDests.some(c => c.onPath);

        // Drop from couple centre to mid-rail
        lines.push({ x1: couple.cx, y1: yBot, x2: couple.cx, y2: midY, onPath: anyChildOnPath });

        // Horizontal rail
        if (allChildDests.length > 1) {
          lines.push({ x1: minCX, y1: midY, x2: maxCX, y2: midY, onPath: anyChildOnPath });
        } else if (Math.abs(allChildDests[0].cx - couple.cx) > 0.5) {
          lines.push({ x1: couple.cx, y1: midY, x2: allChildDests[0].cx, y2: midY, onPath: anyChildOnPath });
        }

        // Drops to each child
        allChildDests.forEach(child => {
          lines.push({ x1: child.cx, y1: midY, x2: child.cx, y2: child.y, onPath: child.onPath });
        });
      });

      connectorLayer.selectAll('line.conn')
        .data(lines)
        .join('line')
        .attr('class', 'conn')
        .attr('x1', d => d.x1).attr('y1', d => d.y1)
        .attr('x2', d => d.x2).attr('y2', d => d.y2)
        .attr('stroke',           d => d.onPath ? '#ffffff' : '#444')
        .attr('stroke-width',     d => d.onPath ? 2 : 1.5)
        .attr('stroke-dasharray', d => d.onPath ? null : '4,3');
    }

    function renderSubtree(data) {
      people      = data.people;
      couples     = data.couples;
      pathSet     = new Set(data.path);
      personMap   = Object.fromEntries(people.map(p => [p.id, p]));
      personCouple = {};
      couples.forEach(c => { personCouple[c.spouseA] = c; personCouple[c.spouseB] = c; });

      // Clear leftover state from previous render
      couples.forEach(c => { delete c.gen; delete c.subtreeWidth; });
      people.forEach(p => { delete p.soloX; delete p.soloY; delete p.soloCX; });

      connectorLayer.selectAll('*').remove();
      nodeLayer.selectAll('*').remove();

      if (couples.length === 0) return;

      assignGenerations();
      computeSubtreeWidths();
      computePositions();
      renderConnectors();
      renderNodes();

      // Fit tree in viewport
      const maxGen = Math.max(...couples.map(c => c.gen));
      const treeW  = couples[0].subtreeWidth + PADDING * 2;
      const treeH  = (maxGen + 1) * ROW_HEIGHT + PADDING * 2;
      const wrap   = document.getElementById('canvas-wrap');
      const vw = wrap.clientWidth, vh = wrap.clientHeight;
      const scale = Math.min(treeW > vw ? vw / treeW : 1, treeH > vh ? vh / treeH : 1, 1);
      const tx = (vw - treeW * scale) / 2;
      const ty = PADDING * scale;
      zoom = d3.zoom().scaleExtent([0.2, 3])
        .on('zoom', e => zoomLayer.attr('transform', e.transform));
      svg.call(zoom).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    }

    // ===== SEARCH DROPDOWNS =====
    function setupPicker(inputId, dropdownId, onSelect) {
      const input    = document.getElementById(inputId);
      const dropdown = document.getElementById(dropdownId);

      function renderDropdown(query) {
        const q = query.trim().toLowerCase();
        const matches = q
          ? allPeople.filter(p => p.name.toLowerCase().includes(q))
          : allPeople;

        dropdown.innerHTML = matches.length === 0
          ? '<div class="dropdown-item no-results">No results</div>'
          : matches.slice(0, 20).map(p =>
              `<div class="dropdown-item" data-id="${p.id}">${p.name}${p.birth ? ` (b. ${p.birth})` : ''}</div>`
            ).join('');

        dropdown.querySelectorAll('.dropdown-item[data-id]').forEach(el => {
          el.addEventListener('mousedown', e => {
            e.preventDefault();
            const person = allPeople.find(p => p.id === el.dataset.id);
            if (person) {
              input.value = person.name;
              input.classList.add('has-selection');
              dropdown.classList.remove('open');
              onSelect(person);
            }
          });
        });

        dropdown.classList.add('open');
      }

      input.addEventListener('focus', () => renderDropdown(input.value));
      input.addEventListener('input', () => {
        input.classList.remove('has-selection');
        onSelect(null);
        renderDropdown(input.value);
      });
      input.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.remove('open'), 150);
      });
    }

    function updateFindBtn() {
      document.getElementById('find-btn').disabled = !(selectedA && selectedB);
    }

    setupPicker('input-a', 'dropdown-a', p => { selectedA = p; updateFindBtn(); });
    setupPicker('input-b', 'dropdown-b', p => { selectedB = p; updateFindBtn(); });

    // ===== FIND BUTTON =====
    document.getElementById('find-btn').addEventListener('click', async () => {
      if (!selectedA || !selectedB) return;

      const errEl = document.getElementById('search-error');
      const msgEl = document.getElementById('canvas-msg');
      errEl.classList.remove('visible');

      if (selectedA.id === selectedB.id) {
        errEl.textContent = 'Please select two different people.';
        errEl.classList.add('visible');
        return;
      }

      msgEl.textContent = 'Finding relationship…';
      msgEl.style.display = 'flex';

      const res  = await fetch(`/api/relationship?a=${selectedA.id}&b=${selectedB.id}`);
      const body = await res.json();

      if (!res.ok) {
        msgEl.textContent = res.status === 404
          ? 'No relationship found between these two people.'
          : (body.error || 'An error occurred.');
        connectorLayer.selectAll('*').remove();
        nodeLayer.selectAll('*').remove();
        return;
      }

      msgEl.style.display = 'none';
      renderSubtree(body);
    });

    // ===== URL PARAM PRE-FILL =====
    function prefillFromUrl() {
      const aId = new URLSearchParams(window.location.search).get('a');
      if (!aId) return;
      const person = allPeople.find(p => p.id === aId);
      if (!person) return;
      document.getElementById('input-a').value = person.name;
      document.getElementById('input-a').classList.add('has-selection');
      selectedA = person;
      updateFindBtn();
      document.getElementById('input-b').focus();
    }

    // ===== INIT =====
    async function init() {
      svg            = d3.select('#rel-tree');
      zoomLayer      = svg.append('g').attr('class', 'zoom-layer');
      connectorLayer = zoomLayer.append('g').attr('class', 'connectors');
      nodeLayer      = zoomLayer.append('g').attr('class', 'nodes');

      const res = await fetch('/api/tree');
      if (!res.ok) { console.error('Failed to load tree data'); return; }
      const data = await res.json();
      allPeople = data.people;

      prefillFromUrl();
    }

    init();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the page renders correctly**

With `node server/src/index.js` running, open `http://localhost:5001/relationship.html` and confirm:
- Page shows "Relationship Finder" in the top bar with "← Back to Tree" link
- Two labelled search inputs and a disabled "Find" button are visible
- Typing in either input opens a filtered dropdown of names
- Selecting a person from both dropdowns enables the "Find" button
- Clicking "Find" shows "Finding relationship…" then renders a tree
- Path nodes have a gold border; non-path spouse nodes are dimmed with dashed borders
- Path connectors are white/solid; connectors to non-path nodes are dashed/grey

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/ACER/Projects/claude/family-tree add relationship.html
git -C C:/Users/ACER/Projects/claude/family-tree commit -m "feat: add relationship.html with D3 subtree visualization"
```

---

### Task 3: Add "Find Relationship To…" to `index.html` context menu

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add menu item to the `#ctx-menu` HTML**

In `index.html`, find the `#ctx-menu` div. It will look like:

```html
<div id="ctx-menu">
  <button id="ctx-edit">Edit</button>
  <button id="ctx-add-spouse">Add Spouse</button>
  <button id="ctx-add-child">Add Child</button>
  <div class="ctx-sep"></div>
  <button id="ctx-remove">Remove</button>
  <div id="ctx-confirm-area"></div>
</div>
```

Add the new button between "Add Child" and the separator:

```html
<div id="ctx-menu">
  <button id="ctx-edit">Edit</button>
  <button id="ctx-add-spouse">Add Spouse</button>
  <button id="ctx-add-child">Add Child</button>
  <button id="ctx-relationship">Find Relationship To…</button>
  <div class="ctx-sep"></div>
  <button id="ctx-remove">Remove</button>
  <div id="ctx-confirm-area"></div>
</div>
```

- [ ] **Step 2: Add the click handler**

In `index.html`, find the block that registers `ctx-add-child`'s click listener. It will look like:

```js
document.getElementById('ctx-add-child').addEventListener('click', () => {
  ...
});
```

After that block, add:

```js
document.getElementById('ctx-relationship').addEventListener('click', () => {
  if (!ctxTarget) return;
  const personId = ctxTarget.person.id;
  hideCtxMenu();
  window.location.href = `relationship.html?a=${personId}`;
});
```

- [ ] **Step 3: Verify the context menu works end-to-end**

With the server running, open `http://localhost:5001`, right-click any person card and confirm:
- "Find Relationship To…" appears in the context menu
- Clicking it navigates to `relationship.html` with that person's name pre-filled in "Person A"
- The cursor is placed in the "Person B" input ready for typing
- Clicking "← Back to Tree" returns to `index.html`

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/ACER/Projects/claude/family-tree add index.html
git -C C:/Users/ACER/Projects/claude/family-tree commit -m "feat: add Find Relationship To context menu item in main tree"
```
