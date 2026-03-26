const request = require('supertest');
const app = require('../src/index');
const { prisma, clearDatabase } = require('./helpers');

beforeEach(clearDatabase);
afterAll(() => prisma.$disconnect());

test('deletes solo person with no couple', async () => {
  const p = await prisma.person.create({ data: { name: 'Solo', birth: 1990, gender: 'F' } });
  const res = await request(app).delete(`/api/people/${p.id}`);
  expect(res.status).toBe(200);
  expect(res.body.deleted).toContain(p.id);
  expect(await prisma.person.findUnique({ where: { id: p.id } })).toBeNull();
});

test('deletes solo person and removes their CoupleChild parent link', async () => {
  const p1 = await prisma.person.create({ data: { name: 'Arthur',  birth: 1910, gender: 'M' } });
  const p2 = await prisma.person.create({ data: { name: 'Eleanor', birth: 1913, gender: 'F' } });
  const parentCouple = await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });
  const child = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: parentCouple.id, childId: child.id, sortOrder: 0 } });

  const res = await request(app).delete(`/api/people/${child.id}`);
  expect(res.status).toBe(200);
  const link = await prisma.coupleChild.findUnique({
    where: { coupleId_childId: { coupleId: parentCouple.id, childId: child.id } },
  });
  expect(link).toBeNull();
});

test('deleting spouseB dissolves couple; spouseA remains', async () => {
  const spouseA = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });
  const spouseB = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F' } });
  const couple  = await prisma.couple.create({ data: { spouseAId: spouseA.id, spouseBId: spouseB.id } });

  const res = await request(app).delete(`/api/people/${spouseB.id}`);
  expect(res.status).toBe(200);
  expect(res.body.deleted).toEqual([spouseB.id]);
  expect(await prisma.person.findUnique({ where: { id: spouseA.id } })).toBeTruthy();
  expect(await prisma.couple.findUnique({ where: { id: couple.id } })).toBeNull();
});

test('deleting spouseA also deletes spouseB', async () => {
  const spouseA = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });
  const spouseB = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F' } });
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
  const gp1 = await prisma.person.create({ data: { name: 'GP1', birth: 1890, gender: 'M' } });
  const gp2 = await prisma.person.create({ data: { name: 'GP2', birth: 1893, gender: 'F' } });
  const gpCouple = await prisma.couple.create({ data: { spouseAId: gp1.id, spouseBId: gp2.id } });

  const spouseA = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });
  const spouseB = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F' } });
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
  const p1 = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });
  const p2 = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F' } });
  const couple = await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });
  const child  = await prisma.person.create({ data: { name: 'James',  birth: 1962, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple.id, childId: child.id, sortOrder: 0 } });

  const res = await request(app).delete(`/api/people/${p1.id}`);
  expect(res.status).toBe(409);
});

test('returns 404 for unknown id', async () => {
  const res = await request(app).delete('/api/people/does-not-exist');
  expect(res.status).toBe(404);
});

// ===== PUT /api/people/:id =====

describe('PUT /api/people/:id', () => {
  let person;

  beforeEach(async () => {
    person = await prisma.person.create({
      data: { name: 'Alice', birth: 1980, gender: 'F' },
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
});
