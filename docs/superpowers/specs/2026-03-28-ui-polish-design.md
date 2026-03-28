# UI Polish — Design Spec

**Date:** 2026-03-28
**Status:** Approved

---

## Overview

Two small polish changes to the family tree UI:

1. **Modal persistence** — Add/Edit popups no longer close on outside click; an explicit X button is added.
2. **Long name handling** — Person card names that overflow the 70px text area wrap to a second line and truncate with "…"; hovering shows the full name.

Both changes affect `index.html`. The name handling fix also applies to `relationship.html`.

---

## Change 1 — Modal close behavior

### Current behavior
Clicking anywhere outside `#modal-box` closes the modal (`click` listener on `#modal-overlay` that checks `e.target === modalOverlay`).

### New behavior
- Outside click **no longer closes** the modal.
- An **×** button is added to the top-right corner of `#modal-box`.
- The modal closes only when:
  - The × button is clicked, or
  - The form is successfully submitted.
- The Cancel button continues to call `closeModal()` as before.

### Implementation details

**HTML change** — add the close button inside `#modal-box`, before `<h2 id="modal-title">`:
```html
<button id="modal-close-btn" aria-label="Close">&times;</button>
```

**CSS** — position the button absolutely in the top-right corner of `#modal-box`:
```css
#modal-box { position: relative; }
#modal-close-btn {
  position: absolute;
  top: 10px;
  right: 12px;
  background: none;
  border: none;
  color: #aaa;
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}
#modal-close-btn:hover { color: #fff; }
```

**JS change** — remove the outside-click listener and wire up the close button:
```js
// Remove:
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

// Add:
document.getElementById('modal-close-btn').addEventListener('click', closeModal);
```

---

## Change 2 — Long names in SVG person cards

### Layout constants (unchanged)
- Card: `NODE_W=120`, `NODE_H=60`
- Avatar: `cx=22, cy=30, r=18` — occupies left ~40px
- Text area: starts at `x=46`, available width ~70px (to `x=116`)
- Current name position: `y=21`, years: `y=39`

### New layout for names

| Lines used | Name line 1 `y` | Name line 2 `y` | Years `y` |
|------------|-----------------|-----------------|-----------|
| 1 line     | 21              | —               | 39        |
| 2 lines    | 16              | 29              | 44        |

Years shift down by 5px when a second name line is needed. This keeps the years visually separated.

### Name splitting algorithm

A shared JS function `splitName(name)` returns `{ line1, line2 }`:

1. Measure word groups using an estimated character width (≈7px at 12px font).
2. Try to pack as many words as fit within 70px onto line 1.
3. Remaining words form line 2.
4. If line 2 text still exceeds 70px, truncate to the last word that fits and append `…`.
5. If the entire name fits on one line (no overflow), return `{ line1: name, line2: null }`.

**Character-width estimation:** Use `name.length * 7` as a conservative proxy. SVG has no native `measureText`; this avoids a hidden `<canvas>` dependency. A per-character constant of 7px at 12px/600 weight is a slight overestimate, which errs toward wrapping early rather than clipping.

### Tooltip

A `<title>` child element is added to each person card `<g>`:
```js
cardG.append('title').text(d => d.person.name);
```
This provides a native browser tooltip on hover with zero extra code. It shows the full name regardless of whether it was truncated.

### Files affected

- `index.html` — `renderNodes()` function (~line 655–675)
- `relationship.html` — `renderNodes()` function (same structure)

Both files share identical `renderNodes()` implementations and both need the same fix.

---

## Out of Scope

- Resizing cards to be taller — keeping the 120×60 constraint
- Canvas-based text measurement — character-width estimate is sufficient
- Tooltips on non-truncated names — the `<title>` always renders (harmless, consistent)
- Any changes to other parts of the modal or tree rendering
