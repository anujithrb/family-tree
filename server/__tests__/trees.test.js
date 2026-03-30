const request = require('supertest');
const app = require('../src/index');
const { prisma } = require('./helpers');

afterAll(() => prisma.$disconnect());

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const baseTree = (suffix) => ({
  name: `Test Family ${suffix}`,
  spouseA: { name: `Alice ${suffix}`, birth: 1960, gender: 'F' },
  spouseB: { name: `Bob ${suffix}`, birth: 1958, gender: 'M' },
});

// ── POST /api/trees ───────────────────────────────────────────────
describe('POST /api/trees', () => {
  test('creates tree + couple with no children', async () => {
    const suffix = uid();
    const res = await request(app).post('/api/trees').send(baseTree(suffix));

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe(`Test Family ${suffix}`);

    const people = await prisma.person.findMany({ where: { treeId: res.body.id } });
    expect(people).toHaveLength(2);

    const couple = await prisma.couple.findFirst({
      where: { spouseA: { treeId: res.body.id } },
    });
    expect(couple).toBeTruthy();
  });

  test('creates tree + couple + children with correct sortOrder', async () => {
    const suffix = uid();
    const res = await request(app)
      .post('/api/trees')
      .send({
        ...baseTree(suffix),
        children: [
          { name: `Child1 ${suffix}`, birth: 1985, gender: 'M' },
          { name: `Child2 ${suffix}`, birth: 1988, gender: 'F' },
        ],
      });

    expect(res.status).toBe(201);

    const people = await prisma.person.findMany({ where: { treeId: res.body.id } });
    expect(people).toHaveLength(4);

    const couple = await prisma.couple.findFirst({
      where: { spouseA: { treeId: res.body.id } },
      include: { children: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(couple.children[0].sortOrder).toBe(0);
    expect(couple.children[1].sortOrder).toBe(1);
  });

  test('returns 400 if name is missing', async () => {
    const suffix = uid();
    const { name, ...body } = baseTree(suffix);
    const res = await request(app).post('/api/trees').send(body);
    expect(res.status).toBe(400);
  });

  test('returns 400 if spouseA is missing', async () => {
    const suffix = uid();
    const { spouseA, ...body } = baseTree(suffix);
    const res = await request(app).post('/api/trees').send(body);
    expect(res.status).toBe(400);
  });

  test('returns 400 if spouseB is missing', async () => {
    const suffix = uid();
    const { spouseB, ...body } = baseTree(suffix);
    const res = await request(app).post('/api/trees').send(body);
    expect(res.status).toBe(400);
  });
});

// ── GET /api/trees ────────────────────────────────────────────────
describe('GET /api/trees', () => {
  test('returns list including newly created tree with root couple names', async () => {
    const suffix = uid();
    const created = await request(app).post('/api/trees').send(baseTree(suffix));
    expect(created.status).toBe(201);

    const res = await request(app).get('/api/trees');
    expect(res.status).toBe(200);

    const match = res.body.find(t => t.id === created.body.id);
    expect(match).toBeTruthy();
    expect(match.name).toBe(`Test Family ${suffix}`);
    expect(match.rootCouple.spouseA).toBe(`Alice ${suffix}`);
    expect(match.rootCouple.spouseB).toBe(`Bob ${suffix}`);
  });
});

// ── GET /api/tree?treeId=X ────────────────────────────────────────
describe('GET /api/tree with treeId filter', () => {
  test('returns only people and couples for that tree', async () => {
    const s1 = uid();
    const s2 = uid();
    const t1 = await request(app).post('/api/trees').send(baseTree(s1));
    const t2 = await request(app).post('/api/trees').send(baseTree(s2));

    const res = await request(app).get(`/api/tree?treeId=${t1.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.people).toHaveLength(2);
    expect(res.body.people.every(p => p.treeId === t1.body.id)).toBe(true);
  });

  test('returns 400 if treeId param is missing', async () => {
    const res = await request(app).get('/api/tree');
    expect(res.status).toBe(400);
  });

  test('returns 400 if treeId is unknown', async () => {
    const res = await request(app).get('/api/tree?treeId=does-not-exist');
    expect(res.status).toBe(400);
  });

  test('includes treeName in response', async () => {
    const suffix = uid();
    const created = await request(app).post('/api/trees').send(baseTree(suffix));
    const res = await request(app).get(`/api/tree?treeId=${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.treeName).toBe(`Test Family ${suffix}`);
  });
});
