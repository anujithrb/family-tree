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
