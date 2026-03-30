const request = require('supertest');
const app = require('../src/index');
const { prisma, clearDatabase } = require('./helpers');
const path = require('path');
const fs   = require('fs');

let treeId;
beforeAll(async () => {
  const tree = await prisma.familyTree.create({ data: { name: `people-test-${Date.now()}` } });
  treeId = tree.id;
});
beforeEach(clearDatabase);
afterAll(() => prisma.$disconnect());

test('deletes solo person with no couple', async () => {
  const p = await prisma.person.create({ data: { name: 'Solo', birth: 1990, gender: 'F', treeId } });
  const res = await request(app).delete(`/api/people/${p.id}`);
  expect(res.status).toBe(200);
  expect(res.body.deleted).toContain(p.id);
  expect(await prisma.person.findUnique({ where: { id: p.id } })).toBeNull();
});

test('deletes solo person and removes their CoupleChild parent link', async () => {
  const p1 = await prisma.person.create({ data: { name: 'Arthur',  birth: 1910, gender: 'M', treeId } });
  const p2 = await prisma.person.create({ data: { name: 'Eleanor', birth: 1913, gender: 'F', treeId } });
  const parentCouple = await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });
  const child = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
  await prisma.coupleChild.create({ data: { coupleId: parentCouple.id, childId: child.id, sortOrder: 0 } });

  const res = await request(app).delete(`/api/people/${child.id}`);
  expect(res.status).toBe(200);
  const link = await prisma.coupleChild.findUnique({
    where: { coupleId_childId: { coupleId: parentCouple.id, childId: child.id } },
  });
  expect(link).toBeNull();
});

test('deleting spouseB dissolves couple; spouseA remains', async () => {
  const spouseA = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
  const spouseB = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F', treeId } });
  const couple  = await prisma.couple.create({ data: { spouseAId: spouseA.id, spouseBId: spouseB.id } });

  const res = await request(app).delete(`/api/people/${spouseB.id}`);
  expect(res.status).toBe(200);
  expect(res.body.deleted).toEqual([spouseB.id]);
  expect(await prisma.person.findUnique({ where: { id: spouseA.id } })).toBeTruthy();
  expect(await prisma.couple.findUnique({ where: { id: couple.id } })).toBeNull();
});

test('deleting spouseA also deletes spouseB', async () => {
  const spouseA = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
  const spouseB = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F', treeId } });
  await prisma.couple.create({ data: { spouseAId: spouseA.id, spouseBId: spouseB.id } });

  const res = await request(app).delete(`/api/people/${spouseA.id}`);
  expect(res.status).toBe(200);
  expect(res.body.deleted).toHaveLength(2);
  expect(res.body.deleted).toContain(spouseA.id);
  expect(res.body.deleted).toContain(spouseB.id);
  expect(await prisma.person.findUnique({ where: { id: spouseB.id } })).toBeNull();
});

test('deleting spouseA removes spouseB CoupleChild parent link if present', async () => {
  // Setup: grandparent couple → spouseB (edge case: spouseB is also a bloodline child)
  const gp1 = await prisma.person.create({ data: { name: 'GP1', birth: 1890, gender: 'M', treeId } });
  const gp2 = await prisma.person.create({ data: { name: 'GP2', birth: 1893, gender: 'F', treeId } });
  const gpCouple = await prisma.couple.create({ data: { spouseAId: gp1.id, spouseBId: gp2.id } });

  const spouseA = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
  const spouseB = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F', treeId } });
  // spouseB is a child of grandparent couple (edge case the spec guards against)
  await prisma.coupleChild.create({ data: { coupleId: gpCouple.id, childId: spouseB.id, sortOrder: 0 } });
  await prisma.couple.create({ data: { spouseAId: spouseA.id, spouseBId: spouseB.id } });

  const res = await request(app).delete(`/api/people/${spouseA.id}`);
  expect(res.status).toBe(200);
  // spouseB's parent link should also be gone
  const link = await prisma.coupleChild.findUnique({
    where: { coupleId_childId: { coupleId: gpCouple.id, childId: spouseB.id } },
  });
  expect(link).toBeNull();
});

test('returns 409 when person has children', async () => {
  const p1 = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
  const p2 = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F', treeId } });
  const couple = await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });
  const child  = await prisma.person.create({ data: { name: 'James',  birth: 1962, gender: 'M', treeId } });
  await prisma.coupleChild.create({ data: { coupleId: couple.id, childId: child.id, sortOrder: 0 } });

  const res = await request(app).delete(`/api/people/${p1.id}`);
  expect(res.status).toBe(409);
});

test('returns 404 for unknown id', async () => {
  const res = await request(app).delete('/api/people/does-not-exist');
  expect(res.status).toBe(404);
});

test('deletes the profile picture file when person is removed', async () => {
  const person = await prisma.person.create({ data: { name: 'Picasso', birth: 1970, gender: 'M', treeId } });

  // Give the person a fake profile picture
  const filename = 'test-pic.png';
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, 'fake image data');

  await prisma.person.update({
    where: { id: person.id },
    data: { profilePicture: `/uploads/${filename}` },
  });

  const res = await request(app).delete(`/api/people/${person.id}`);
  expect(res.status).toBe(200);
  expect(fs.existsSync(filePath)).toBe(false);
});

// ===== PUT /api/people/:id =====

describe('PUT /api/people/:id', () => {
  let person;

  beforeEach(async () => {
    person = await prisma.person.create({
      data: { name: 'Alice', birth: 1980, gender: 'F', treeId },
    });
  });

  test('updates text fields', async () => {
    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice Updated')
      .field('birth', '1981')
      .field('death', '2050')
      .field('gender', 'F');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice Updated');
    expect(res.body.birth).toBe(1981);
    expect(res.body.death).toBe(2050);
    expect(res.body.gender).toBe('F');

    const db = await prisma.person.findUnique({ where: { id: person.id } });
    expect(db.name).toBe('Alice Updated');
    expect(db.birth).toBe(1981);
  });

  test('clears death year when empty string provided', async () => {
    await prisma.person.update({ where: { id: person.id }, data: { death: 2050 } });

    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice')
      .field('birth', '1980')
      .field('death', '')
      .field('gender', 'F');

    expect(res.status).toBe(200);
    expect(res.body.death).toBeNull();
  });

  test('returns 404 for unknown id', async () => {
    const res = await request(app)
      .put('/api/people/does-not-exist')
      .field('name', 'X')
      .field('birth', '1990')
      .field('gender', 'M');

    expect(res.status).toBe(404);
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('birth', '1980')
      .field('gender', 'F');

    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid birth year', async () => {
    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice')
      .field('birth', '999')
      .field('gender', 'F');

    expect(res.status).toBe(400);
  });

  test('returns 400 when death year is before birth year', async () => {
    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice')
      .field('birth', '1980')
      .field('death', '1950')
      .field('gender', 'F');

    expect(res.status).toBe(400);
  });

  // --- Photo upload tests ---
  // A known-valid 1×1 PNG (67 bytes) encoded as base64
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  afterEach(() => {
    // Clean up any files created in server/uploads/ during tests
    const uploadsDir = path.join(__dirname, '../uploads');
    if (fs.existsSync(uploadsDir)) {
      fs.readdirSync(uploadsDir).forEach(f => {
        try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (_) {}
      });
    }
  });

  test('uploads a photo and sets profilePicture on the person', async () => {
    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice')
      .field('birth', '1980')
      .field('gender', 'F')
      .attach('profilePicture', TINY_PNG, { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.profilePicture).toMatch(/^\/uploads\/.+\.png$/);

    // File exists on disk
    const filename = path.basename(res.body.profilePicture);
    const filePath = path.join(__dirname, '../uploads', filename);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('removePhoto=true clears profilePicture and deletes the file', async () => {
    // First upload a photo
    const uploadRes = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice')
      .field('birth', '1980')
      .field('gender', 'F')
      .attach('profilePicture', TINY_PNG, { filename: 'photo.png', contentType: 'image/png' });
    expect(uploadRes.status).toBe(200);

    const filename = path.basename(uploadRes.body.profilePicture);
    const filePath = path.join(__dirname, '../uploads', filename);
    expect(fs.existsSync(filePath)).toBe(true);

    // Now remove it
    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice')
      .field('birth', '1980')
      .field('gender', 'F')
      .field('removePhoto', 'true');

    expect(res.status).toBe(200);
    expect(res.body.profilePicture).toBeNull();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('removePhoto=true wins when a file is also sent', async () => {
    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice')
      .field('birth', '1980')
      .field('gender', 'F')
      .field('removePhoto', 'true')
      .attach('profilePicture', TINY_PNG, { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.profilePicture).toBeNull();

    // Uploaded file was not kept on disk
    const uploadsDir = path.join(__dirname, '../uploads');
    const files = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
    expect(files).toHaveLength(0);

    // DB-level check
    const db = await prisma.person.findUnique({ where: { id: person.id } });
    expect(db.profilePicture).toBeNull();
  });

  test('returns 400 and writes no file for disallowed MIME type', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf content');
    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice')
      .field('birth', '1980')
      .field('gender', 'F')
      .attach('profilePicture', pdfBuffer, { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);

    const uploadsDir = path.join(__dirname, '../uploads');
    const files = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
    expect(files).toHaveLength(0);
  });

  test('returns 413 for file exceeding 2 MB', async () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1);
    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice')
      .field('birth', '1980')
      .field('gender', 'F')
      .attach('profilePicture', oversized, { filename: 'big.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(413);
  });
});

test('GET /api/tree includes profilePicture in person objects', async () => {
  const p1 = await prisma.person.create({ data: { name: 'A', birth: 1900, gender: 'M', treeId } });
  const p2 = await prisma.person.create({ data: { name: 'B', birth: 1902, gender: 'F', treeId } });
  await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });

  const res = await request(app).get(`/api/tree?treeId=${treeId}`);
  expect(res.status).toBe(200);
  expect(res.body.people.every(p => 'profilePicture' in p)).toBe(true);
});
