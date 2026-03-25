const { createPerson } = require('../src/lib/createPerson');
const { prisma, clearDatabase } = require('./helpers');

beforeEach(clearDatabase);
afterAll(() => prisma.$disconnect());

test('creates a valid person', async () => {
  const p = await createPerson({ name: 'Alice', birth: 1990, death: null, gender: 'F' }, prisma);
  expect(p.id).toBeDefined();
  expect(p.name).toBe('Alice');
  expect(p.birth).toBe(1990);
  expect(p.death).toBeNull();
});

test('trims whitespace from name', async () => {
  const p = await createPerson({ name: '  Alice  ', birth: 1990, gender: 'F' }, prisma);
  expect(p.name).toBe('Alice');
});

test('throws 400 for blank name', async () => {
  await expect(createPerson({ name: '  ', birth: 1990, gender: 'F' }, prisma))
    .rejects.toMatchObject({ status: 400 });
});

test('throws 400 for missing birth', async () => {
  await expect(createPerson({ name: 'Alice', gender: 'F' }, prisma))
    .rejects.toMatchObject({ status: 400 });
});

test('throws 400 for birth below 1000', async () => {
  await expect(createPerson({ name: 'Alice', birth: 999, gender: 'F' }, prisma))
    .rejects.toMatchObject({ status: 400 });
});

test('throws 400 for birth above 2100', async () => {
  await expect(createPerson({ name: 'Alice', birth: 2101, gender: 'F' }, prisma))
    .rejects.toMatchObject({ status: 400 });
});

test('throws 400 for death before birth', async () => {
  await expect(createPerson({ name: 'Alice', birth: 1990, death: 1980, gender: 'F' }, prisma))
    .rejects.toMatchObject({ status: 400 });
});

test('throws 400 for invalid gender', async () => {
  await expect(createPerson({ name: 'Alice', birth: 1990, gender: 'X' }, prisma))
    .rejects.toMatchObject({ status: 400 });
});
