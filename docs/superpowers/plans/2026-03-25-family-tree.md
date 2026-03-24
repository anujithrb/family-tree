# Family Tree Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single `index.html` file that renders a 5-generation family tree using D3.js v7, with spouse pairs side-by-side, child connectors to couple midpoints, and full zoom/pan.

**Architecture:** All code lives in one `index.html`. Data (people + couples arrays) is embedded as JS. A custom 3-pass layout algorithm (generation → subtree width → x position) computes node positions, then D3 renders SVG elements. `d3.zoom()` is applied to a `<g class="zoom-layer">` inside the viewport-filling SVG.

**Tech Stack:** HTML5, D3.js v7 (CDN), vanilla JS, no build tools.

---

## File Structure

```
index.html   ← entire app: data + layout + rendering + styles
```

Internal `<script>` sections (in order):
1. Sample data (`people`, `couples`)
2. Layout constants + helper maps
3. Layout algorithm (3 passes)
4. Render functions (nodes, connectors)
5. Zoom setup + initialise

---

## Task 1: HTML Scaffold + Page Styles

**Files:**
- Create: `index.html`

- [ ] **Step 1: Create the HTML shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Family Tree</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #0f1117; }
    svg#tree { display: block; width: 100vw; height: 100vh; cursor: grab; }
    svg#tree:active { cursor: grabbing; }
    #hint {
      position: fixed; bottom: 16px; left: 20px;
      color: #444; font: 12px/1 system-ui, sans-serif;
      pointer-events: none; user-select: none;
    }
  </style>
</head>
<body>
  <svg id="tree"></svg>
  <div id="hint">Scroll to zoom · Drag to pan</div>
  <script>
    // DATA, LAYOUT, RENDER will go here
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify scaffold in browser**

Open `index.html` in any browser.
Expected: solid dark (`#0f1117`) background, hint text visible bottom-left, no console errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add HTML scaffold with styles and D3 CDN"
```

---

## Task 2: Embed Sample Data

**Files:**
- Modify: `index.html` (inside `<script>`)

- [ ] **Step 1: Add the people array**

> **Note:** The `people` and `couples` arrays below are the authoritative source of truth for IDs and relationships. The spec's sample data table is illustrative and uses different ID assignments — follow the arrays here, not the table.

Replace the `// DATA, LAYOUT, RENDER will go here` comment with:

```js
// ===== DATA =====
const people = [
  // Gen 1
  { id:"p1",  name:"Arthur Smith",   birth:1910, death:1985, gender:"M" },
  { id:"p2",  name:"Eleanor Grant",  birth:1913, death:1990, gender:"F" },
  // Gen 2 — children of c1 + married-in partners
  { id:"p3",  name:"Thomas Smith",   birth:1935, death:2005, gender:"M" },
  { id:"p4",  name:"Helen Moore",    birth:1938, death:2010, gender:"F" },
  { id:"p5",  name:"Margaret Smith", birth:1937, death:2015, gender:"F" },
  { id:"p6",  name:"George Hill",    birth:1935, death:2000, gender:"M" },
  { id:"p7",  name:"Robert Smith",   birth:1940, death:null, gender:"M" },
  { id:"p8",  name:"Clara West",     birth:1942, death:null, gender:"F" },
  // Gen 3 — children of Gen 2 couples + married-in partners
  { id:"p9",  name:"James Smith",    birth:1962, death:null, gender:"M" },
  { id:"p10", name:"Laura Chen",     birth:1964, death:null, gender:"F" },
  { id:"p11", name:"Susan Smith",    birth:1965, death:null, gender:"F" },
  { id:"p12", name:"David Park",     birth:1963, death:null, gender:"M" },
  { id:"p13", name:"Anne Hill",      birth:1963, death:null, gender:"F" },
  { id:"p14", name:"Michael Torres", birth:1961, death:null, gender:"M" },
  { id:"p15", name:"Peter Hill",     birth:1966, death:null, gender:"M" },
  { id:"p16", name:"Rachel Adams",   birth:1968, death:null, gender:"F" },
  { id:"p17", name:"Daniel Smith",   birth:1968, death:null, gender:"M" },
  { id:"p18", name:"Emma White",     birth:1970, death:null, gender:"F" },
  { id:"p19", name:"Claire Smith",   birth:1971, death:null, gender:"F" },
  { id:"p20", name:"Noah Brown",     birth:1969, death:null, gender:"M" },
  // Gen 4 — children of Gen 3 couples + married-in partners
  { id:"p21", name:"Oliver Smith",   birth:1990, death:null, gender:"M" },
  { id:"p22", name:"Sophia Lee",     birth:1992, death:null, gender:"F" },
  { id:"p23", name:"Lily Smith",     birth:1992, death:null, gender:"F" },
  { id:"p24", name:"Ethan Clark",    birth:1990, death:null, gender:"M" },
  { id:"p25", name:"Ryan Torres",    birth:1988, death:null, gender:"M" },
  { id:"p26", name:"Mia Johnson",    birth:1990, death:null, gender:"F" },
  { id:"p27", name:"Zoe Hill",       birth:1994, death:null, gender:"F" },
  { id:"p28", name:"Liam Evans",     birth:1992, death:null, gender:"M" },
  { id:"p29", name:"Max Smith",      birth:1994, death:null, gender:"M" },
  { id:"p30", name:"Isla Gray",      birth:1996, death:null, gender:"F" },
  // Gen 4 solo leaf — child of c6 (Susan + David) who does not marry
  { id:"p31", name:"Sophie Park",    birth:1993, death:null, gender:"F" },
  // Gen 5 solo leaves — children of Gen 4 couples
  { id:"p32", name:"Ben Smith",      birth:2015, death:null, gender:"M" },
  { id:"p33", name:"Ella Smith",     birth:2017, death:null, gender:"F" },
  { id:"p34", name:"Finn Clark",     birth:2016, death:null, gender:"M" },
  { id:"p35", name:"Ava Torres",     birth:2014, death:null, gender:"F" },
  { id:"p36", name:"Leo Torres",     birth:2016, death:null, gender:"M" },
  { id:"p37", name:"Grace Hill",     birth:2018, death:null, gender:"F" },
  { id:"p38", name:"Jack Smith",     birth:2019, death:null, gender:"M" },
];
```

- [ ] **Step 2: Add the couples array**

Immediately after the `people` array:

```js
const couples = [
  // Gen 1
  { id:"c1",  spouseA:"p1",  spouseB:"p2",  children:["p3","p5","p7"]  },
  // Gen 2
  { id:"c2",  spouseA:"p3",  spouseB:"p4",  children:["p9","p11"]      },
  { id:"c3",  spouseA:"p5",  spouseB:"p6",  children:["p13","p15"]     },
  { id:"c4",  spouseA:"p7",  spouseB:"p8",  children:["p17","p19"]     },
  // Gen 3
  { id:"c5",  spouseA:"p9",  spouseB:"p10", children:["p21","p23"]     },
  { id:"c6",  spouseA:"p11", spouseB:"p12", children:["p31"]           },
  { id:"c7",  spouseA:"p13", spouseB:"p14", children:["p25"]           },
  { id:"c8",  spouseA:"p15", spouseB:"p16", children:["p27"]           },
  { id:"c9",  spouseA:"p17", spouseB:"p18", children:["p29"]           },
  { id:"c10", spouseA:"p19", spouseB:"p20", children:[]                },
  // Gen 4
  { id:"c11", spouseA:"p21", spouseB:"p22", children:["p32","p33"]     },
  { id:"c12", spouseA:"p23", spouseB:"p24", children:["p34"]           },
  { id:"c13", spouseA:"p25", spouseB:"p26", children:["p35","p36"]     },
  { id:"c14", spouseA:"p27", spouseB:"p28", children:["p37"]           },
  { id:"c15", spouseA:"p29", spouseB:"p30", children:["p38"]           },
];
```

- [ ] **Step 3: Verify data in browser console**

Open browser DevTools console and run:
```js
console.log(people.length, couples.length);
```
Expected: `38 15`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: embed 38-person 5-generation sample data"
```

---

## Task 3: Layout Constants + Helper Maps

**Files:**
- Modify: `index.html` (inside `<script>`, after data arrays)

- [ ] **Step 1: Add constants and colour palette**

```js
// ===== CONSTANTS =====
const NODE_W      = 120;   // person card width
const NODE_H      = 60;    // person card height
const SPOUSE_GAP  = 12;    // gap between the two spouse cards
const SUBTREE_GAP = 48;    // gap between sibling subtrees
const ROW_HEIGHT  = 120;   // vertical distance between generation tops (NODE_H + VERTICAL_GAP)
const VERTICAL_GAP = 60;   // space between bottom of parent row and top of child row
const PADDING     = 40;    // canvas padding on all sides

const C = {
  M: { fill:'#1e3a5f', stroke:'#2a5fa0', avatar:'#2a5fa0', years:'#aac8f0' },
  F: { fill:'#3d1f2e', stroke:'#a04a6a', avatar:'#a04a6a', years:'#f0c0d0' },
};
```

- [ ] **Step 2: Add helper maps**

```js
// ===== HELPER MAPS =====
const personMap = Object.fromEntries(people.map(p => [p.id, p]));

// personId → the couple where they are spouseA or spouseB
const personCouple = {};
couples.forEach(c => {
  personCouple[c.spouseA] = c;
  personCouple[c.spouseB] = c;
});

// personId → the couple where they appear as a child
const personParentCouple = {};
couples.forEach(c => c.children.forEach(pid => { personParentCouple[pid] = c; }));
```

- [ ] **Step 3: Verify maps in console**

```js
console.log(personCouple["p3"].id);       // "c2"
console.log(personParentCouple["p3"].id); // "c1"
console.log(personCouple["p32"]);         // undefined (p32 is a solo leaf — no couple)
```

Expected output: `c2`, `c1`, `undefined`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add layout constants, colour palette, and helper maps"
```

---

## Task 4: Layout Pass 1 — Generation Assignment

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add generation assignment function**

```js
// ===== LAYOUT PASS 1: GENERATION ASSIGNMENT =====
function assignGenerations() {
  const root = couples[0]; // c1 — the root ancestor couple
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

- [ ] **Step 2: Call the function and verify**

Add after the function definition:

```js
assignGenerations();
```

Then in the browser console:

```js
console.log(couples.map(c => c.id + ':gen' + c.gen).join(', '));
```

Expected: `c1:gen0, c2:gen1, c3:gen1, c4:gen1, c5:gen2, c6:gen2, c7:gen2, c8:gen2, c9:gen2, c10:gen2, c11:gen3, c12:gen3, c13:gen3, c14:gen3, c15:gen3`

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: layout pass 1 — assign generation numbers to couples"
```

---

## Task 5: Layout Pass 2 — Subtree Widths

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add subtree width function**

```js
// ===== LAYOUT PASS 2: SUBTREE WIDTHS (bottom-up) =====
function computeSubtreeWidths() {
  const COUPLE_W = NODE_W * 2 + SPOUSE_GAP; // 252px — minimum width for any couple

  const maxGen = Math.max(...couples.map(c => c.gen));

  for (let gen = maxGen; gen >= 0; gen--) {
    couples.filter(c => c.gen === gen).forEach(couple => {
      // Children who themselves form a couple (coupled children)
      const childCouples = couple.children
        .map(pid => personCouple[pid])
        .filter(Boolean);

      // Children who appear in no couple (solo leaf children)
      const soloCount = couple.children.filter(pid => !personCouple[pid]).length;
      const soloWidth = soloCount > 0
        ? soloCount * NODE_W + (soloCount - 1) * SUBTREE_GAP
        : 0;

      if (childCouples.length === 0) {
        // Leaf couple: at least couple unit width; expand if solo leaves need more
        couple.subtreeWidth = Math.max(COUPLE_W, soloWidth || COUPLE_W);
      } else {
        const coupledWidth = childCouples.reduce((s, cc) => s + cc.subtreeWidth, 0)
          + (childCouples.length - 1) * SUBTREE_GAP;
        // Take the larger of coupled-children span or solo-leaf span
        couple.subtreeWidth = Math.max(coupledWidth, soloWidth);
      }
    });
  }
}
```

- [ ] **Step 2: Call and verify**

```js
computeSubtreeWidths();
```

In the browser console:

```js
console.log('c1:', couples[0].subtreeWidth);  // should be > 1000 (wide tree)
console.log('c11:', couples.find(c=>c.id==='c11').subtreeWidth); // 288 (2 solo leaves: 2*120+48)
console.log('c10:', couples.find(c=>c.id==='c10').subtreeWidth); // 252 (no children)
```

Expected: `c1` is approximately `2124`, `c11` is `288`, `c10` is `252`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: layout pass 2 — compute subtree widths bottom-up"
```

---

## Task 6: Layout Pass 3 — X/Y Positions

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add x/y positioning function**

```js
// ===== LAYOUT PASS 3: X/Y POSITIONS (top-down) =====
function computePositions() {
  const root = couples[0];
  root.cx = root.subtreeWidth / 2 + PADDING;

  const queue = [root];
  while (queue.length) {
    const couple = queue.shift();

    // Y from generation
    couple.y    = couple.gen * ROW_HEIGHT + PADDING;
    couple.yBot = couple.y + NODE_H;

    // Spouse card left edges (cards touch the gap, no overlap)
    couple.spouseAX = couple.cx - SPOUSE_GAP / 2 - NODE_W;
    couple.spouseBX = couple.cx + SPOUSE_GAP / 2;

    // Position child COUPLES centered under this couple
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

    // Position SOLO LEAF children (evenly spaced under this couple)
    const soloIds = couple.children.filter(pid => !personCouple[pid]);
    if (soloIds.length > 0) {
      const soloGen = couple.gen + 1;
      const totalW = soloIds.length * NODE_W + (soloIds.length - 1) * SUBTREE_GAP;
      let x = couple.cx - totalW / 2;
      soloIds.forEach(pid => {
        const p = personMap[pid];
        p.soloX  = x;
        p.soloY  = soloGen * ROW_HEIGHT + PADDING;
        p.soloCX = x + NODE_W / 2;
        x += NODE_W + SUBTREE_GAP;
      });
    }
  }
}
```

- [ ] **Step 2: Call and verify**

```js
computePositions();
```

In the console:

```js
const c1 = couples[0];
console.log('c1 cx:', c1.cx, 'spouseAX:', c1.spouseAX, 'spouseBX:', c1.spouseBX);
// spouseBX - spouseAX - NODE_W should equal SPOUSE_GAP (12)
console.log('gap check:', c1.spouseBX - c1.spouseAX - NODE_W); // 12
console.log('p31 soloX:', personMap['p31'].soloX); // should be defined
```

Expected: gap check = `12`, `p31.soloX` is a number.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: layout pass 3 — compute x/y positions for all nodes"
```

---

## Task 7: Render Person Nodes

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the SVG zoom-layer and render-nodes function**

```js
// ===== RENDER =====
const svg = d3.select('#tree');
const zoomLayer = svg.append('g').attr('class', 'zoom-layer');
const connectorLayer = zoomLayer.append('g').attr('class', 'connectors');
const nodeLayer     = zoomLayer.append('g').attr('class', 'nodes');

function yearsLabel(p) {
  return p.death ? `${p.birth}–${p.death}` : `b. ${p.birth}`;
}

function renderNodes() {
  // Build flat list: all coupled people + all solo leaf people
  const nodeData = [];

  couples.forEach(couple => {
    nodeData.push({ person: personMap[couple.spouseA], x: couple.spouseAX, y: couple.y });
    nodeData.push({ person: personMap[couple.spouseB], x: couple.spouseBX, y: couple.y });
  });

  people
    .filter(p => p.soloX !== undefined)
    .forEach(p => nodeData.push({ person: p, x: p.soloX, y: p.soloY }));

  const groups = nodeLayer
    .selectAll('g.person')
    .data(nodeData, d => d.person.id)
    .join('g')
    .attr('class', 'person')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  // Background card
  groups.append('rect')
    .attr('width', NODE_W)
    .attr('height', NODE_H)
    .attr('rx', 8)
    .attr('fill',   d => C[d.person.gender].fill)
    .attr('stroke', d => C[d.person.gender].stroke)
    .attr('stroke-width', 1.5);

  // Avatar circle
  groups.append('circle')
    .attr('cx', 22)
    .attr('cy', NODE_H / 2)
    .attr('r', 18)
    .attr('fill', d => C[d.person.gender].avatar);

  // Initial letter in avatar
  groups.append('text')
    .attr('x', 22)
    .attr('y', NODE_H / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', '#ffffff')
    .attr('font-size', '15px')
    .attr('font-weight', '700')
    .attr('font-family', 'system-ui, sans-serif')
    .text(d => d.person.name[0]);

  // Name
  groups.append('text')
    .attr('x', 46)
    .attr('y', NODE_H / 2 - 9)
    .attr('fill', '#ffffff')
    .attr('font-size', '12px')
    .attr('font-weight', '600')
    .attr('font-family', 'system-ui, sans-serif')
    .text(d => d.person.name);

  // Years
  groups.append('text')
    .attr('x', 46)
    .attr('y', NODE_H / 2 + 9)
    .attr('fill', d => C[d.person.gender].years)
    .attr('font-size', '10px')
    .attr('font-family', 'system-ui, sans-serif')
    .text(d => yearsLabel(d.person));
}

renderNodes();
```

- [ ] **Step 2: Verify nodes render**

Reload `index.html`.
Expected: person cards visible near the top-left of the dark background (no zoom yet). Cards should show names, initials in avatars, years. Male cards are dark blue, female cards are dark rose.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: render person nodes with avatar, name, and years"
```

---

## Task 8: Render Connectors

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add renderConnectors function**

```js
function renderConnectors() {
  const lines = [];

  couples.forEach(couple => {
    // 1. Horizontal spouse connector (right edge of spouseA → left edge of spouseB)
    lines.push({
      x1: couple.spouseAX + NODE_W,
      y1: couple.y + NODE_H / 2,
      x2: couple.spouseBX,
      y2: couple.y + NODE_H / 2,
    });

    // 2. Child connectors
    const childCouples = couple.children
      .map(pid => personCouple[pid])
      .filter(Boolean);
    const soloIds = couple.children.filter(pid => !personCouple[pid]);

    const allChildren = [
      ...childCouples.map(cc => ({ cx: cc.cx,               y: cc.y    })),
      ...soloIds.map(pid => {
        const p = personMap[pid];
        return { cx: p.soloCX, y: p.soloY };
      }),
    ];

    if (allChildren.length === 0) return;

    const yBot = couple.yBot;
    const midY = yBot + VERTICAL_GAP / 2;
    const cxs  = allChildren.map(c => c.cx);
    const minCX = Math.min(...cxs);
    const maxCX = Math.max(...cxs);

    // Drop from couple midpoint down to midY
    lines.push({ x1: couple.cx, y1: yBot,  x2: couple.cx, y2: midY });

    // Horizontal bar across all children (only when >1 child)
    if (allChildren.length > 1) {
      lines.push({ x1: minCX, y1: midY, x2: maxCX, y2: midY });
    }

    // Vertical drops from bar to each child top
    allChildren.forEach(child => {
      lines.push({ x1: child.cx, y1: midY, x2: child.cx, y2: child.y });
    });
  });

  connectorLayer
    .selectAll('line.connector')
    .data(lines)
    .join('line')
    .attr('class', 'connector')
    .attr('x1', d => d.x1).attr('y1', d => d.y1)
    .attr('x2', d => d.x2).attr('y2', d => d.y2)
    .attr('stroke', '#aaaaaa')
    .attr('stroke-width', 1.5);
}

renderConnectors();
```

- [ ] **Step 2: Verify connectors**

Reload the page.
Expected:
- Horizontal lines connecting each spouse pair at card-edge-to-card-edge (no visible gap).
- Vertical drop from couple midpoint, horizontal bar, drops to each child couple.
- Solo leaf `p31` (Sophie Park) connected with a drop from her parents (Susan + David).
- Gen 5 solo leaves connected from their Gen 4 parent couples.

- [ ] **Step 3: Confirm connector render order (connectors behind nodes)**

The connector layer was appended to `zoomLayer` before the node layer, so connectors are naturally behind nodes. Verify in the browser that node cards appear on top of connector lines where they overlap.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: render spouse connectors and child branch lines"
```

---

## Task 9: D3 Zoom + Pan + Initial Fit

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add zoom setup and initial transform**

```js
// ===== ZOOM + PAN =====
function setupZoom() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Total tree canvas width (used for horizontal fit-on-load)
  const treeW = couples[0].subtreeWidth + PADDING * 2;

  // Fit entire tree horizontally on load; otherwise center it
  const scale    = treeW > vw ? vw / treeW : 1;
  const translateX = (vw - treeW * scale) / 2;
  const translateY = PADDING * scale;

  const initialTransform = d3.zoomIdentity
    .translate(translateX, translateY)
    .scale(scale);

  const zoom = d3.zoom()
    .scaleExtent([0.2, 3])
    .on('zoom', event => {
      zoomLayer.attr('transform', event.transform);
    });

  svg
    .call(zoom)
    .call(zoom.transform, initialTransform);
}

setupZoom();
```

- [ ] **Step 2: Verify zoom and pan**

Reload the page.
Expected:
- Full tree visible and centered on load (or scaled to fit on smaller screens).
- Scroll wheel zooms in/out smoothly.
- Click and drag pans the tree.
- Zoom stays within 20% – 300% of original size.

- [ ] **Step 3: Verify the hint text is visible**

The `#hint` div is `position: fixed` so it stays in place during pan/zoom. Confirm it's visible in the bottom-left corner.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add d3.zoom with fit-on-load initial transform and scale extent"
```

---

## Task 10: Final Polish + Execution Order Guard

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Wrap all calls in a single init function**

Each previous task added a temporary call at the end of its section (e.g. `assignGenerations()`, `renderNodes()`). **Remove all of those individual calls** and replace them with a single IIFE at the very end of the `<script>` block:

```js
// ===== INIT =====
(function init() {
  assignGenerations();
  computeSubtreeWidths();
  computePositions();
  renderConnectors(); // connectors first so they render behind nodes
  renderNodes();
  setupZoom();
})();
```

- [ ] **Step 2: Test on a narrow viewport**

Resize the browser window to ~600px wide (use DevTools device emulation).
Expected: tree auto-scales on load so the whole tree is visible; zoom/pan still works at any size.

- [ ] **Step 3: Test on a wide viewport**

At full desktop width (~1400px+).
Expected: tree renders at scale 1, centered horizontally, all 5 generations visible top to bottom.

- [ ] **Step 4: Check console for errors**

Open DevTools console. Reload.
Expected: no errors or warnings.

- [ ] **Step 5: Final commit**

```bash
git add index.html
git commit -m "feat: wrap init in IIFE, verify render order and cross-viewport behaviour"
```
