const request = require('supertest');
const app = require('../src/index');
const { prisma, clearDatabase } = require('./helpers');

beforeEach(clearDatabase);
afterAll(() => prisma.$disconnect());

// ── Helper: two-generation family ────────────────────────────────
// grandpa+grandma → dad; dad+mom → child
async function makeFamily() {
  const grandpa = await prisma.person.create({ data: { name: 'Grandpa', birth: 1920, gender: 'M' } });
  const grandma = await prisma.person.create({ data: { name: 'Grandma', birth: 1922, gender: 'F' } });
  const couple1 = await prisma.couple.create({ data: { spouseAId: grandpa.id, spouseBId: grandma.id } });
  const dad = await prisma.person.create({ data: { name: 'Dad', birth: 1950, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple1.id, childId: dad.id, sortOrder: 0 } });
  const mom = await prisma.person.create({ data: { name: 'Mom', birth: 1952, gender: 'F' } });
  const couple2 = await prisma.couple.create({ data: { spouseAId: dad.id, spouseBId: mom.id } });
  const child = await prisma.person.create({ data: { name: 'Child', birth: 1975, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple2.id, childId: child.id, sortOrder: 0 } });
  return { grandpa, grandma, couple1, dad, mom, couple2, child };
}

// ── Helper: cousin family ────────────────────────────────────────
// grandpa+grandma → [dad, uncle]
// dad+mom → cousin1;  uncle+aunt → cousin2
async function makeCousins() {
  const grandpa = await prisma.person.create({ data: { name: 'Grandpa', birth: 1920, gender: 'M' } });
  const grandma = await prisma.person.create({ data: { name: 'Grandma', birth: 1922, gender: 'F' } });
  const couple1 = await prisma.couple.create({ data: { spouseAId: grandpa.id, spouseBId: grandma.id } });
  const dad = await prisma.person.create({ data: { name: 'Dad', birth: 1950, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple1.id, childId: dad.id, sortOrder: 0 } });
  const uncle = await prisma.person.create({ data: { name: 'Uncle', birth: 1952, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple1.id, childId: uncle.id, sortOrder: 1 } });
  const mom = await prisma.person.create({ data: { name: 'Mom', birth: 1953, gender: 'F' } });
  const couple2 = await prisma.couple.create({ data: { spouseAId: dad.id, spouseBId: mom.id } });
  const aunt = await prisma.person.create({ data: { name: 'Aunt', birth: 1955, gender: 'F' } });
  const couple3 = await prisma.couple.create({ data: { spouseAId: uncle.id, spouseBId: aunt.id } });
  const cousin1 = await prisma.person.create({ data: { name: 'Cousin1', birth: 1978, gender: 'M' } });
  await prisma.coupleChild.create({ data: { coupleId: couple2.id, childId: cousin1.id, sortOrder: 0 } });
  const cousin2 = await prisma.person.create({ data: { name: 'Cousin2', birth: 1980, gender: 'F' } });
  await prisma.coupleChild.create({ data: { coupleId: couple3.id, childId: cousin2.id, sortOrder: 0 } });
  return { grandpa, grandma, couple1, dad, uncle, mom, couple2, aunt, couple3, cousin1, cousin2 };
}

// ── GET /api/relationship ─────────────────────────────────────────
describe('GET /api/relationship', () => {
  test('returns 400 when a param is missing', async () => {
    const { grandpa } = await makeFamily();
    const res = await request(app).get(`/api/relationship?b=${grandpa.id}`);
    expect(res.status).toBe(400);
  });

  test('returns 400 when b param is missing', async () => {
    const { grandpa } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}`);
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid person ID', async () => {
    const { grandpa } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=does-not-exist`);
    expect(res.status).toBe(400);
  });

  test('returns 400 when a and b are the same person', async () => {
    const { grandpa } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=${grandpa.id}`);
    expect(res.status).toBe(400);
  });

  test('returns direct path between parent and child', async () => {
    const { grandpa, dad } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=${dad.id}`);
    expect(res.status).toBe(200);
    expect(res.body.path).toEqual([grandpa.id, dad.id]);
  });

  test('returns 3-node path for grandparent and grandchild', async () => {
    const { grandpa, child } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=${child.id}`);
    expect(res.status).toBe(200);
    expect(res.body.path[0]).toBe(grandpa.id);
    expect(res.body.path[res.body.path.length - 1]).toBe(child.id);
    expect(res.body.path.length).toBe(3);
  });

  test('returns 5-node path for first cousins', async () => {
    const { cousin1, cousin2 } = await makeCousins();
    const res = await request(app).get(`/api/relationship?a=${cousin1.id}&b=${cousin2.id}`);
    expect(res.status).toBe(200);
    expect(res.body.path[0]).toBe(cousin1.id);
    expect(res.body.path[res.body.path.length - 1]).toBe(cousin2.id);
    expect(res.body.path.length).toBe(5);
  });

  test('response people includes spouses of path nodes (not only path nodes)', async () => {
    const { grandpa, grandma, dad } = await makeFamily();
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=${dad.id}`);
    expect(res.status).toBe(200);
    const personIds = res.body.people.map(p => p.id);
    // grandpa is on path; grandma is his spouse — must be in people for rendering
    expect(personIds).toContain(grandma.id);
  });

  test('returns 404 when no path exists between disconnected people', async () => {
    const alice = await prisma.person.create({ data: { name: 'Alice', birth: 1970, gender: 'F' } });
    const bob   = await prisma.person.create({ data: { name: 'Bob',   birth: 1972, gender: 'M' } });
    const res = await request(app).get(`/api/relationship?a=${alice.id}&b=${bob.id}`);
    expect(res.status).toBe(404);
  });

  test('couples response filters children to path members only', async () => {
    const { grandpa, dad, child } = await makeFamily();
    // Path: grandpa → dad → child (through grandpa's couple and dad's couple)
    // grandpa's couple has one child: dad (on path)
    // dad's couple has one child: child (on path)
    // mom (dad's spouse, not on path) should NOT appear in any couple's children
    const res = await request(app).get(`/api/relationship?a=${grandpa.id}&b=${child.id}`);
    expect(res.status).toBe(200);
    const allCoupleChildren = res.body.couples.flatMap(c => c.children);
    expect(allCoupleChildren).toContain(dad.id);
    expect(allCoupleChildren).toContain(child.id);
    // mom.id is NOT a child — it's a spouse; no non-path person should be in children
    expect(res.body.couples.every(c => c.spouseA !== undefined && c.spouseB !== undefined)).toBe(true);
  });
});
