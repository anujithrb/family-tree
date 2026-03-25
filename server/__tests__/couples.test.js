const request = require('supertest');
const app = require('../src/index');
const { prisma, clearDatabase } = require('./helpers');

beforeEach(clearDatabase);
afterAll(() => prisma.$disconnect());

// ── POST /api/couples ──────────────────────────────────────────
describe('POST /api/couples', () => {
  test('creates couple and new spouse person', async () => {
    const person = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });

    const res = await request(app)
      .post('/api/couples')
      .send({ existingPersonId: person.id, spouse: { name: 'Helen', birth: 1938, gender: 'F' } });

    expect(res.status).toBe(201);
    expect(res.body.spouseAId).toBe(person.id);
    expect(res.body.spouseBId).toBeDefined();

    const newSpouse = await prisma.person.findUnique({ where: { id: res.body.spouseBId } });
    expect(newSpouse.name).toBe('Helen');
  });

  test('returns 404 for unknown existingPersonId', async () => {
    const res = await request(app)
      .post('/api/couples')
      .send({ existingPersonId: 'does-not-exist', spouse: { name: 'Helen', birth: 1938, gender: 'F' } });
    expect(res.status).toBe(404);
  });

  test('returns 409 if person already in a couple as spouseA', async () => {
    const p1 = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });
    const p2 = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F' } });
    await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });

    const res = await request(app)
      .post('/api/couples')
      .send({ existingPersonId: p1.id, spouse: { name: 'Jane', birth: 1940, gender: 'F' } });
    expect(res.status).toBe(409);
  });

  test('returns 409 if person already in a couple as spouseB', async () => {
    const p1 = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });
    const p2 = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F' } });
    await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });

    const res = await request(app)
      .post('/api/couples')
      .send({ existingPersonId: p2.id, spouse: { name: 'Jane', birth: 1940, gender: 'M' } });
    expect(res.status).toBe(409);
  });

  test('returns 400 for invalid spouse data', async () => {
    const person = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });
    const res = await request(app)
      .post('/api/couples')
      .send({ existingPersonId: person.id, spouse: { name: '', birth: 1938, gender: 'F' } });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/couples/:id/children ────────────────────────────
describe('POST /api/couples/:id/children', () => {
  async function makeCouple() {
    const p1 = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });
    const p2 = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F' } });
    return prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });
  }

  test('adds child and returns person', async () => {
    const couple = await makeCouple();
    const res = await request(app)
      .post(`/api/couples/${couple.id}/children`)
      .send({ name: 'James', birth: 1962, gender: 'M' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('James');

    const link = await prisma.coupleChild.findFirst({ where: { coupleId: couple.id } });
    expect(link).toBeTruthy();
    expect(link.sortOrder).toBe(0);
  });

  test('sortOrder increments for each subsequent child', async () => {
    const couple = await makeCouple();
    await request(app).post(`/api/couples/${couple.id}/children`).send({ name: 'James', birth: 1962, gender: 'M' });
    await request(app).post(`/api/couples/${couple.id}/children`).send({ name: 'Susan', birth: 1965, gender: 'F' });

    const links = await prisma.coupleChild.findMany({
      where: { coupleId: couple.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(links[0].sortOrder).toBe(0);
    expect(links[1].sortOrder).toBe(1);
  });

  test('returns 404 for unknown couple', async () => {
    const res = await request(app)
      .post('/api/couples/does-not-exist/children')
      .send({ name: 'James', birth: 1962, gender: 'M' });
    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid child data', async () => {
    const couple = await makeCouple();
    const res = await request(app)
      .post(`/api/couples/${couple.id}/children`)
      .send({ name: 'James', birth: 500, gender: 'M' });
    expect(res.status).toBe(400);
  });
});
