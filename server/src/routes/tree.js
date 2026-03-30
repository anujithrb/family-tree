const { Router } = require('express');
const prisma = require('../lib/prisma');

const router = Router();

router.get('/tree', async (req, res, next) => {
  try {
    const { treeId } = req.query;
    if (!treeId) return res.status(400).json({ error: 'treeId query param is required' });

    const familyTree = await prisma.familyTree.findUnique({ where: { id: treeId } });
    if (!familyTree) return res.status(400).json({ error: 'Unknown treeId' });

    const people = await prisma.person.findMany({ where: { treeId } });
    const personIds = people.map(p => p.id);

    const couplesRaw = await prisma.couple.findMany({
      where: { spouseAId: { in: personIds } },
      include: { children: { orderBy: { sortOrder: 'asc' } } },
    });

    // Sort so the root couple (neither spouse is a child anywhere) comes first
    const childIds = new Set(couplesRaw.flatMap(c => c.children.map(cc => cc.childId)));
    const rootIdx = couplesRaw.findIndex(
      c => !childIds.has(c.spouseAId) && !childIds.has(c.spouseBId)
    );
    const sorted = rootIdx > 0
      ? [couplesRaw[rootIdx], ...couplesRaw.filter((_, i) => i !== rootIdx)]
      : couplesRaw;

    const couples = sorted.map(c => ({
      id: c.id,
      spouseA: c.spouseAId,
      spouseB: c.spouseBId,
      children: c.children.map(cc => cc.childId),
    }));

    res.json({ treeName: familyTree.name, people, couples });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
