# Family Tree Visualizer — Design Spec
Date: 2026-03-25

## Overview

A single self-contained `index.html` file that renders a 5-generation family tree using D3.js v7 (loaded from CDN). No build step, no server required — open in any browser. No interactivity (static visualization).

---

## Requirements

- 5 generations of fictional/sample data (~38 people)
- Top-down layout: root ancestor couple at top, descendants flow downward
- Spouses rendered side-by-side, connected by a horizontal line that touches the edges of both cards directly (no gap)
- Children connected via a vertical drop-line from the midpoint of the spouse connector, branching horizontally to each child
- Each person node: rounded-rect card with circular avatar (initials), name, and birth–death years
- Gender coloring: blue for male, rose for female
- Connector lines: neutral gray, 1.5px stroke
- No interactivity (zoom/pan not included)

---

## Output

| Property | Value |
|---|---|
| Format | Single `index.html` |
| Library | D3.js v7 (CDN) |
| Data | Embedded JS arrays in the HTML |
| Font | `system-ui, sans-serif` |
| Interactivity | None |

---

## Layout Constants

All pixel values used by the layout algorithm are defined here:

| Constant | Value | Description |
|---|---|---|
| `NODE_W` | 120px | Width of each person card |
| `NODE_H` | 60px | Height of each person card |
| `SPOUSE_GAP` | 12px | Horizontal gap between the two spouse cards in a couple |
| `SUBTREE_GAP` | 48px | Horizontal gap between adjacent sibling subtrees |
| `ROW_HEIGHT` | 120px | Vertical distance between the top of one generation row and the top of the next |
| `VERTICAL_GAP` | 60px | Space between bottom of a couple's cards (`NODE_H`) and top of the next generation's cards. `ROW_HEIGHT = NODE_H + VERTICAL_GAP` |

**Couple unit width** = `NODE_W + SPOUSE_GAP + NODE_W` = 252px
**Couple center** (`cx`): horizontal midpoint of the couple unit = `left + NODE_W + SPOUSE_GAP/2`

---

## Data Model

Two flat arrays embedded in the HTML:

```js
// One entry per individual
const people = [
  { id: "p1",  name: "Arthur Smith",    birth: 1910, death: 1985, gender: "M" },
  { id: "p2",  name: "Eleanor Grant",   birth: 1913, death: 1990, gender: "F" },
  // ...
]

// One entry per couple; children array lists person IDs
const couples = [
  { id: "c1", spouseA: "p1", spouseB: "p2", children: ["p3","p4","p5"] },
  // ...
]
```

A person who appears as a `child` in one couple entry may appear as a `spouseA` or `spouseB` in another (generational linking). Persons who never marry appear only as a child entry and have no corresponding couple.

---

## Sample Data — 5 Generations

Full couple graph (sketched; implementer builds the people/couples arrays from this):

| Gen | Couple ID | SpouseA | SpouseB | Children |
|---|---|---|---|---|
| 1 | c1 | Arthur Smith M 1910–1985 | Eleanor Grant F 1913–1990 | p3, p4, p5 |
| 2 | c2 | Thomas Smith M 1935–2005 | Helen Moore F 1938–2010 | p6, p7 |
| 2 | c3 | Margaret Smith F 1937–2015 | George Hill M 1935–2000 | p8, p9 |
| 2 | c4 | Robert Smith M 1940– | Clara West F 1942– | p10, p11 |
| 3 | c5 | James Smith M 1962– | Laura Chen F 1964– | p12, p13 |
| 3 | c6 | Susan Smith F 1965– | David Park M 1963– | p14, p15 |
| 3 | c7 | Anne Hill F 1963– | Michael Torres M 1961– | p16, p17 |
| 3 | c8 | Peter Hill M 1966– | Rachel Adams F 1968– | p18, p19 |
| 3 | c9 | Daniel Smith M 1968– | Emma White F 1970– | p20, p21 |
| 3 | c10 | Claire Smith F 1971– | Noah Brown M 1969– | p22, p23 |
| 4 | c11 | Oliver Smith M 1990– | Sophia Lee F 1992– | p24, p25 |
| 4 | c12 | Lily Smith F 1992– | Ethan Clark M 1990– | p26 |
| 4 | c13 | Ryan Torres M 1988– | Mia Johnson F 1990– | p27, p28 |
| 4 | c14 | Zoe Hill F 1994– | Liam Evans M 1992– | p29 |
| 4 | c15 | Max Smith M 1994– | Isla Gray F 1996– | p30 |
| 5 | — | p24: Ben Smith M 2015– | (unpaired) | — |
| 5 | — | p25: Ella Smith F 2017– | (unpaired) | — |
| 5 | — | p26: Finn Clark M 2016– | (unpaired) | — |
| 5 | — | p27: Ava Torres F 2014– | (unpaired) | — |
| 5 | — | p28: Leo Torres M 2016– | (unpaired) | — |
| 5 | — | p29: Grace Hill F 2018– | (unpaired) | — |
| 5 | — | p30: Jack Smith M 2019– | (unpaired) | — |

Total: 15 couples, 38 people.

---

## Layout Algorithm

D3's `d3.tree()` is not used — it has no concept of couple nodes. A custom 3-pass algorithm is used.

### Pass 1 — Generation Assignment (top-down)

Walk the couple graph from the root couple (c1). Assign each couple `couple.gen = 0` for c1, and `couple.gen = parent.gen + 1` for each couple whose spouseA or spouseB is a child of the parent couple.

Solo leaf individuals (Gen 5) are not assigned a `gen` on a couple — their `gen` is derived from their parent couple's gen + 1, and they are laid out as solo nodes.

### Pass 2 — Subtree Width (bottom-up)

For each couple, compute `subtreeWidth`:

- **Leaf couple** (no children who form couples, but may have solo leaf children):
  `subtreeWidth = coupleUnitWidth = NODE_W * 2 + SPOUSE_GAP`
- **Non-leaf couple**:
  `subtreeWidth = sum(child subtreeWidths) + (numChildren - 1) * SUBTREE_GAP`
  where "children" means child couples (not solo leaves). Solo leaves are distributed evenly within the parent couple's own subtree width.

### Pass 3 — X Positioning (top-down)

Starting from the root couple centered at `x = totalTreeWidth / 2`:

- Place each couple so its center is horizontally centered over the span of its children.
- `spouseA.x = cx - SPOUSE_GAP/2 - NODE_W`  (right edge of spouseA card touches left of gap)
- `spouseB.x = cx + SPOUSE_GAP/2`            (left edge of spouseB card touches right of gap)

### Solo Leaf Node Placement

A solo (unpaired) Gen 5 person is treated as a degenerate node:

- Width = `NODE_W` (single card, no partner)
- Midpoint = node center (`soloLeaf.cx = soloLeaf.x + NODE_W / 2`)

When a parent couple has N solo leaf children, they are spaced evenly. The x-center of the k-th leaf (0-indexed) is:

```
soloLeaf.cx = parentLeft + NODE_W/2 + k * (NODE_W + SUBTREE_GAP)
```

The parent couple's `subtreeWidth` for a purely solo-leaf case is:
```
subtreeWidth = N * NODE_W + (N - 1) * SUBTREE_GAP
```

If a parent has both coupled children and solo leaf children, the solo leaves fill the leftover horizontal span within the parent's subtree after coupled children are placed.

**Connector**: same horizontal-bar + drop rule as coupled children — a bar from leftmost to rightmost `soloLeaf.cx` at `midY`, then individual vertical drops to each card's top-center `(soloLeaf.cx, soloLeaf.y)`.

---

## Rendering

### Y Positions

```
couple.y     = couple.gen * ROW_HEIGHT        // top edge of cards in this row
couple.yMid  = couple.y + NODE_H / 2          // vertical center of cards
couple.yBot  = couple.y + NODE_H              // bottom edge of cards
```

### Person Node (`<g class="person">`)

| Element | Detail |
|---|---|
| Rounded rect | width=`NODE_W`, height=`NODE_H`, rx=8, fill: `#1e3a5f` (M) or `#3d1f2e` (F), stroke: `#2a5fa0` (M) or `#a04a6a` (F), stroke-width 1.5 |
| Avatar circle | cx=22 from card left edge, cy=`NODE_H/2`=30, r=18, fill: `#2a5fa0` (M) or `#a04a6a` (F) |
| Initial letter | centered in avatar circle, fill `#ffffff`, font-size 15px, font-weight 700, text-anchor middle, dominant-baseline central |
| Name text | x=46 from card left edge (avatar right + 6px padding), y=`NODE_H/2 - 9`=21, fill `#ffffff`, font-size 12px, font-weight 600, text-anchor start |
| Years text | x=46 from card left edge, y=`NODE_H/2 + 9`=39, fill: `#aac8f0` (M) or `#f0c0d0` (F), font-size 10px, text-anchor start |
| Years format | `"1910–1985"` if death is set; `"b. 1910"` if still living (no death year) |

### Couple Connector (horizontal spouse line)

A `<line>` from:
- x1 = `spouseA.x + NODE_W` (right edge of spouseA card)
- x2 = `spouseB.x` (left edge of spouseB card)
- y1 = y2 = `couple.y + NODE_H/2` (vertical center of both cards)
- stroke `#aaaaaa`, stroke-width 1.5

### Child Connectors

From couple midpoint `cx` to each child couple midpoint `childCx`:

1. **Drop line**: vertical from `(cx, couple.yBot)` to `(cx, midY)` where `midY = couple.yBot + VERTICAL_GAP/2`
2. **Horizontal bar**: from `(leftmostChildCx, midY)` to `(rightmostChildCx, midY)`, stroke `#aaaaaa`, stroke-width 1.5
3. **Child drops**: for each child, vertical from `(childCx, midY)` to `(childCx, childCouple.y)`, stroke `#aaaaaa`, stroke-width 1.5

For a couple with a single child, steps 2 and 3 merge into one straight vertical line.

---

## SVG Canvas

- Total width = root couple's `subtreeWidth` + 80px padding (40px each side)
- Total height = `5 * ROW_HEIGHT + 80px` padding (40px each side)
- Wrapped in a `<div style="overflow:auto">` so the page scrolls if the tree exceeds the viewport
- No D3 zoom/pan

---

## File Structure

```
index.html   ← entire application (data + layout + D3 rendering + inline styles)
```
