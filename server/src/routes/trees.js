const { Router } = require('express');
const prisma = require('../lib/prisma');
const { createPerson } = require('../lib/createPerson');

const router = Router();

// GET /api/trees
router.get('/', async (req, res, next) => {
  try {
    const trees = await prisma.familyTree.findMany({ orderBy: { createdAt: 'desc' } });

    const result = await Promise.all(trees.map(async tree => {
      const people = await prisma.person.findMany({ where: { treeId: tree.id } });
      const personIds = people.map(p => p.id);
      const childIds = new Set(
        (await prisma.coupleChild.findMany({ where: { childId: { in: personIds } } }))
          .map(cc => cc.childId)
      );
      const nonChildIds = personIds.filter(id => !childIds.has(id));
      const rootCouple = await prisma.couple.findFirst({
        where: { spouseAId: { in: nonChildIds } },
        include: { spouseA: true, spouseB: true },
      });

      return {
        id: tree.id,
        name: tree.name,
        createdAt: tree.createdAt,
        rootCouple: rootCouple
          ? { spouseA: rootCouple.spouseA.name, spouseB: rootCouple.spouseB.name }
          : null,
      };
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/trees
router.post('/', async (req, res, next) => {
  try {
    const { name, spouseA, spouseB, children = [] } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!spouseA || typeof spouseA !== 'object') {
      return res.status(400).json({ error: 'spouseA is required' });
    }
    if (!spouseB || typeof spouseB !== 'object') {
      return res.status(400).json({ error: 'spouseB is required' });
    }

    const tree = await prisma.$transaction(async tx => {
      const familyTree = await tx.familyTree.create({ data: { name: name.trim() } });

      const personA = await createPerson({ ...spouseA, treeId: familyTree.id }, tx);
      const personB = await createPerson({ ...spouseB, treeId: familyTree.id }, tx);

      const couple = await tx.couple.create({
        data: { spouseAId: personA.id, spouseBId: personB.id },
      });

      for (let i = 0; i < children.length; i++) {
        const child = await createPerson({ ...children[i], treeId: familyTree.id }, tx);
        await tx.coupleChild.create({
          data: { coupleId: couple.id, childId: child.id, sortOrder: i },
        });
      }

      return familyTree;
    });

    res.status(201).json(tree);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
