const { Router } = require('express');
const prisma = require('../lib/prisma');
const { createPerson } = require('../lib/createPerson');

const router = Router();

// POST /api/couples
router.post('/', async (req, res, next) => {
  try {
    const { existingPersonId, spouse } = req.body;

    const existing = await prisma.person.findUnique({ where: { id: existingPersonId } });
    if (!existing) return res.status(404).json({ error: 'Person not found' });

    const inCouple = await prisma.couple.findFirst({
      where: { OR: [{ spouseAId: existingPersonId }, { spouseBId: existingPersonId }] },
    });
    if (inCouple) return res.status(409).json({ error: 'Person already belongs to a couple' });

    const couple = await prisma.$transaction(async tx => {
      const newSpouse = await createPerson(spouse, tx);
      return tx.couple.create({ data: { spouseAId: existingPersonId, spouseBId: newSpouse.id } });
    });

    res.status(201).json(couple);
  } catch (err) {
    next(err);
  }
});

// POST /api/couples/:id/children
router.post('/:id/children', async (req, res, next) => {
  try {
    const couple = await prisma.couple.findUnique({
      where: { id: req.params.id },
      include: { children: true },
    });
    if (!couple) return res.status(404).json({ error: 'Couple not found' });

    const child = await prisma.$transaction(async tx => {
      const person = await createPerson(req.body, tx);
      await tx.coupleChild.create({
        data: { coupleId: couple.id, childId: person.id, sortOrder: couple.children.length },
      });
      return person;
    });

    res.status(201).json(child);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
