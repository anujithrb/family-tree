const request = require('supertest');
const app = require('../src/index');
const { prisma, clearDatabase } = require('./helpers');

beforeEach(clearDatabase);
afterAll(() => prisma.$disconnect());

test('GET /api/tree returns empty arrays when DB is empty', async () => {
  const res = await request(app).get('/api/tree');
  expect(res.status).toBe(200);
  expect(res.body.people).toEqual([]);
  expect(res.body.couples).toEqual([]);
});

test('GET /api/tree returns correct shape for one couple', async () => {
  const p1 = await prisma.person.create({ data: { name: 'Arthur', birth: 1910, death: 1985, gender: 'M' } });
  const p2 = await prisma.person.create({ data: { name: 'Eleanor', birth: 1913, death: 1990, gender: 'F' } });
  await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });

  const res = await request(app).get('/api/tree');
  expect(res.status).toBe(200);
  expect(res.body.people).toHaveLength(2);
  expect(res.body.couples).toHaveLength(1);
  expect(res.body.couples[0]).toMatchObject({
    spouseA: p1.id,
    spouseB: p2.id,
    children: [],
  });
});

test('GET /api/tree returns children sorted by sortOrder', async () => {
  const p1 = await prisma.person.create({ data: { name: 'Arthur', birth: 1910, gender: 'M' } });
  const p2 = await prisma.person.create({ data: { name: 'Eleanor', birth: 1913, gender: 'F' } });
  const c1 = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M' } });
  const c2 = await prisma.person.create({ data: { name: 'Margaret', birth: 1937, gender: 'F' } });
  const couple = await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });
  await prisma.coupleChild.create({ data: { coupleId: couple.id, childId: c1.id, sortOrder: 0 } });
  await prisma.coupleChild.create({ data: { coupleId: couple.id, childId: c2.id, sortOrder: 1 } });

  const res = await request(app).get('/api/tree');
  expect(res.body.couples[0].children).toEqual([c1.id, c2.id]);
});

test('GET /api/tree places root couple first', async () => {
  const arthur  = await prisma.person.create({ data: { name: 'Arthur',  birth: 1910, gender: 'M' } });
  const eleanor = await prisma.person.create({ data: { name: 'Eleanor', birth: 1913, gender: 'F' } });
  const thomas  = await prisma.person.create({ data: { name: 'Thomas',  birth: 1935, gender: 'M' } });
  const helen   = await prisma.person.create({ data: { name: 'Helen',   birth: 1938, gender: 'F' } });

  const rootCouple  = await prisma.couple.create({ data: { spouseAId: arthur.id,  spouseBId: eleanor.id } });
  const childCouple = await prisma.couple.create({ data: { spouseAId: thomas.id,  spouseBId: helen.id   } });
  await prisma.coupleChild.create({ data: { coupleId: rootCouple.id, childId: thomas.id, sortOrder: 0 } });

  const res = await request(app).get('/api/tree');
  expect(res.body.couples[0].id).toBe(rootCouple.id);
});
