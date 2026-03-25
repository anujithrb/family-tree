const { Router } = require('express');
const prisma = require('../lib/prisma');

const router = Router();

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const person = await prisma.person.findUnique({ where: { id } });
    if (!person) return res.status(404).json({ error: 'Person not found' });

    const couple = await prisma.couple.findFirst({
      where: { OR: [{ spouseAId: id }, { spouseBId: id }] },
      include: { children: true },
    });

    if (couple && couple.children.length > 0) {
      return res.status(409).json({ error: 'Cannot remove a person who has children' });
    }

    const deleted = [id];

    await prisma.$transaction(async tx => {
      if (couple) {
        if (couple.spouseAId === id) {
          // Also delete spouseB (would become unreachable)
          const spouseBId = couple.spouseBId;
          // Remove spouseB from any parent couple's children list (defensive)
          await tx.coupleChild.deleteMany({ where: { childId: spouseBId } });
          // Delete the couple (cascade removes its own CoupleChild rows)
          await tx.couple.delete({ where: { id: couple.id } });
          // Remove target (spouseA) from their parent couple's children list
          await tx.coupleChild.deleteMany({ where: { childId: id } });
          // Delete spouseB person
          await tx.person.delete({ where: { id: spouseBId } });
          deleted.push(spouseBId);
        } else {
          // Deleting spouseB — dissolve couple, spouseA remains
          await tx.couple.delete({ where: { id: couple.id } });
          await tx.coupleChild.deleteMany({ where: { childId: id } });
        }
      } else {
        await tx.coupleChild.deleteMany({ where: { childId: id } });
      }
      await tx.person.delete({ where: { id } });
    });

    res.json({ deleted });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
