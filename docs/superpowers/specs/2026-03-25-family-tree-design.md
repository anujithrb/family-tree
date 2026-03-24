# Family Tree Visualizer — Design Spec
Date: 2026-03-25

## Overview

A single self-contained `index.html` file that renders a 5-generation family tree using D3.js (loaded from CDN). No build step, no server required — open in any browser.

## Requirements

- 5 generations of fictional/sample data (~35–40 people)
- Top-down layout: root ancestor couple at top, descendants flow downward
- Spouses rendered side-by-side, connected by a horizontal line that touches the edges of both cards directly (no gap)
- Children connected via a vertical drop-line from the midpoint of the spouse connector, branching horizontally to each child
- Each person node: rounded-rect card with circular avatar (initials), name, and birth year
- Gender coloring: blue (`#2a5fa0`) for male, rose (`#a04a6a`) for female; matching border on the card
- Connector lines: neutral gray (`#aaaaaa`), 1.5px stroke

## Output

| Property | Value |
|---|---|
| Format | Single `index.html` |
| Library | D3.js v7 (CDN) |
| Data | Embedded JS arrays in the HTML |
| Interactivity | None required (static visualization) |

## Data Model

Two flat arrays embedded in the HTML:

```js
// people — one entry per individual
const people = [
  { id: "p1", name: "Arthur Smith",  birth: 1910, death: 1985, gender: "M" },
  ...
]

// couples — links spouses and lists their children
const couples = [
  { id: "c1", spouseA: "p1", spouseB: "p2", children: ["p3", "p4"] },
  ...
]
```

A person who appears as a child in one couple entry may also appear as a spouse in another couple entry (normal generational linking).

## Layout Algorithm

D3's built-in `d3.tree()` is not used because it has no concept of couple nodes. A custom 3-pass algorithm is used instead:

1. **Generation assignment (top-down)** — walk the couple graph from the root couple, assigning each couple a `generation` integer (0-based). Each couple's children who form their own couples are assigned `generation + 1`.
2. **Subtree width (bottom-up)** — for each couple, calculate the total horizontal space needed by its subtree. Leaf couples (no children who form couples) have a fixed minimum width. Parent couple width = sum of children subtree widths + inter-subtree gap.
3. **X positioning (top-down)** — center each couple over the span of its children. Place spouseA and spouseB at fixed offsets left and right of the couple center.

**Couple midpoint**: `cx = (spouseA.x + spouseB.x) / 2`. The child connector drops from `(cx, coupleBottom)` down to `(cx, childTop - verticalGap/2)`, then branches horizontally to each child couple's midpoint.

## Rendering

### Person Node (`<g class="person">`)
- Rounded rect: width 110px, height 60px, rx 8
- Circular avatar: radius 18px, centered on left third of card, filled with gender color, white initial letter
- Name: right of avatar, white, 13px bold
- Birth year: right of avatar, below name, muted (#aac8f0 / #f0c0d0), 10px

### Couple
- Two person nodes placed at `cx - nodeWidth/2 - gap/2` (spouseA) and `cx + gap/2` (spouseB)
- Horizontal connector: a `<line>` from the right edge of spouseA's card to the left edge of spouseB's card, stroke `#aaaaaa`, stroke-width 1.5

### Child Connectors
- Vertical drop from couple midpoint bottom edge downward
- Horizontal bar at mid-height between generations
- Vertical drops from bar down to each child couple's midpoint top edge

## Sample Data — 5 Generations

| Gen | Couples | Notes |
|---|---|---|
| 1 | 1 | Root: Arthur & Eleanor Smith |
| 2 | 3 | Their 3 children, each married |
| 3 | 6 | 2 children per Gen-2 couple, each married |
| 4 | 5 | ~1–2 children per Gen-3 couple, some married |
| 5 | — | Leaf children only, no spouse shown |

Approximate total: 38 people.

## SVG Canvas

- Width: calculated dynamically from total tree width + padding
- Height: calculated from number of generations × row height (120px) + padding
- Wrapped in a scrollable `<div>` so it works on any screen size
- D3 zoom/pan: optional but recommended for a tree this wide

## File Structure

```
index.html   ← entire application (data + D3 rendering logic + styles)
```
