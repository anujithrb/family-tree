const { Router } = require('express');
const prisma = require('../lib/prisma');

const router = Router();

router.get('/tree', async (req, res, next) => {
  try {
    const [people, couplesRaw] = await Promise.all([
      prisma.person.findMany(),
      prisma.couple.findMany({
        include: { children: { orderBy: { sortOrder: 'asc' } } },
      }),
    ]);

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

    res.json({ people, couples });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
