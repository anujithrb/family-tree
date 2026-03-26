const { Router } = require('express');
const path = require('path');
const fs   = require('fs');
const prisma = require('../lib/prisma');
const upload = require('../middleware/upload');

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

    // Capture spouseB record before the transaction deletes it
    let spouseB = null;
    if (couple && couple.spouseAId === id) {
      spouseB = await prisma.person.findUnique({ where: { id: couple.spouseBId } });
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

    // Delete profile picture files after the DB transaction succeeds
    const deletePhoto = (profilePicture) => {
      if (!profilePicture) return;
      const filePath = path.join(__dirname, '../../uploads', path.basename(profilePicture));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    };
    deletePhoto(person.profilePicture);
    if (spouseB) deletePhoto(spouseB.profilePicture);

    res.json({ deleted });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', (req, res, next) => {
  upload.single('profilePicture')(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.status === 400) {
        return res.status(400).json({ error: uploadErr.message });
      }
      return next(uploadErr);
    }

    try {
      const { id } = req.params;
      const { name, birth: birthStr, death: deathStr, gender, removePhoto } = req.body;

      const birth = parseInt(birthStr, 10);
      const death = deathStr && deathStr !== '' ? parseInt(deathStr, 10) : null;

      // Helper: clean up any freshly uploaded file if we can't proceed
      const cleanup = () => { if (req.file) fs.unlinkSync(req.file.path); };

      if (!name || !name.trim())
        { cleanup(); return res.status(400).json({ error: 'Name is required.' }); }
      if (!birth || isNaN(birth) || birth < 1000 || birth > 2100)
        { cleanup(); return res.status(400).json({ error: 'Birth year must be between 1000 and 2100.' }); }
      if (death !== null && (isNaN(death) || death < birth))
        { cleanup(); return res.status(400).json({ error: 'Death year must be ≥ birth year.' }); }
      if (!gender || !['M', 'F'].includes(gender))
        { cleanup(); return res.status(400).json({ error: 'Gender is required.' }); }

      const existing = await prisma.person.findUnique({ where: { id } });
      if (!existing) { cleanup(); return res.status(404).json({ error: 'Person not found' }); }

      const UPLOADS_DIR = path.join(__dirname, '../../uploads');
      const absPath = (relUrl) => relUrl
        ? path.join(UPLOADS_DIR, path.basename(relUrl))
        : null;

      let profilePicture = existing.profilePicture;
      const oldProfilePicture = existing.profilePicture; // capture before any changes

      if (removePhoto === 'true') {
        // removePhoto wins — ignore any uploaded file, delete old photo
        cleanup(); // discard any uploaded file
        profilePicture = null; // set in memory only — DB update happens below
      } else if (req.file) {
        // New photo: multer already wrote the file — update DB, then delete old
        const newRelPath = `/uploads/${req.file.filename}`;
        const oldRelPath = existing.profilePicture;
        let updated;
        try {
          updated = await prisma.person.update({
            where: { id },
            data: { name: name.trim(), birth, death, gender, profilePicture: newRelPath },
          });
        } catch (dbErr) {
          fs.unlinkSync(req.file.path); // roll back new file
          throw dbErr;
        }
        // DB committed — safe to delete old file
        const old = absPath(oldRelPath);
        if (old && fs.existsSync(old)) fs.unlinkSync(old);
        return res.json(updated);
      }

      const updated = await prisma.person.update({
        where: { id },
        data: { name: name.trim(), birth, death, gender, profilePicture },
      });

      // Delete old file AFTER DB commit succeeds (safe for removePhoto)
      if (removePhoto === 'true' && oldProfilePicture) {
        const old = absPath(oldProfilePicture);
        if (old && fs.existsSync(old)) fs.unlinkSync(old);
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
});

module.exports = router;
