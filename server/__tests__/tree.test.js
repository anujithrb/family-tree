const request = require('supertest');
const app = require('../src/index');
const { prisma, clearDatabase } = require('./helpers');

let treeId;
// This tree outlives clearDatabase (which only clears People/Couples) — intentional scope anchor
beforeAll(async () => {
  const tree = await prisma.familyTree.create({ data: { name: `tree-test-${Date.now()}` } });
  treeId = tree.id;
});
beforeEach(clearDatabase);
afterAll(() => prisma.$disconnect());

test('GET /api/tree returns 400 when treeId is missing', async () => {
  const res = await request(app).get('/api/tree');
  expect(res.status).toBe(400);
});

test('GET /api/tree returns empty arrays when DB is empty for that tree', async () => {
  const res = await request(app).get(`/api/tree?treeId=${treeId}`);
  expect(res.status).toBe(200);
  expect(res.body.people).toEqual([]);
  expect(res.body.couples).toEqual([]);
});

test('GET /api/tree returns correct shape for one couple', async () => {
  const p1 = await prisma.person.create({ data: { name: 'Arthur', birth: 1910, death: 1985, gender: 'M', treeId } });
  const p2 = await prisma.person.create({ data: { name: 'Eleanor', birth: 1913, death: 1990, gender: 'F', treeId } });
  await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });

  const res = await request(app).get(`/api/tree?treeId=${treeId}`);
  expect(res.status).toBe(200);
  expect(res.body.people).toHaveLength(2);
  expect(res.body.couples).toHaveLength(1);
  expect(res.body.couples[0]).toMatchObject({ spouseA: p1.id, spouseB: p2.id, children: [] });
});

test('GET /api/tree returns children sorted by sortOrder', async () => {
  const p1 = await prisma.person.create({ data: { name: 'Arthur', birth: 1910, gender: 'M', treeId } });
  const p2 = await prisma.person.create({ data: { name: 'Eleanor', birth: 1913, gender: 'F', treeId } });
  const c1 = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
  const c2 = await prisma.person.create({ data: { name: 'Margaret', birth: 1937, gender: 'F', treeId } });
  const couple = await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });
  await prisma.coupleChild.create({ data: { coupleId: couple.id, childId: c1.id, sortOrder: 0 } });
  await prisma.coupleChild.create({ data: { coupleId: couple.id, childId: c2.id, sortOrder: 1 } });

  const res = await request(app).get(`/api/tree?treeId=${treeId}`);
  expect(res.body.couples[0].children).toEqual([c1.id, c2.id]);
});

test('GET /api/tree places root couple first', async () => {
  const arthur  = await prisma.person.create({ data: { name: 'Arthur',  birth: 1910, gender: 'M', treeId } });
  const eleanor = await prisma.person.create({ data: { name: 'Eleanor', birth: 1913, gender: 'F', treeId } });
  const thomas  = await prisma.person.create({ data: { name: 'Thomas',  birth: 1935, gender: 'M', treeId } });
  const helen   = await prisma.person.create({ data: { name: 'Helen',   birth: 1938, gender: 'F', treeId } });

  const rootCouple  = await prisma.couple.create({ data: { spouseAId: arthur.id, spouseBId: eleanor.id } });
  await prisma.couple.create({ data: { spouseAId: thomas.id, spouseBId: helen.id } });
  await prisma.coupleChild.create({ data: { coupleId: rootCouple.id, childId: thomas.id, sortOrder: 0 } });

  const res = await request(app).get(`/api/tree?treeId=${treeId}`);
  expect(res.body.couples[0].id).toBe(rootCouple.id);
});

test('GET /api/tree returns treeName', async () => {
  const res = await request(app).get(`/api/tree?treeId=${treeId}`);
  expect(res.body.treeName).toBeDefined();
});
