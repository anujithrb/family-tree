const { prisma } = require('./helpers');
const { createPerson } = require('../src/lib/createPerson');

let treeId;
beforeAll(async () => {
  const tree = await prisma.familyTree.create({ data: { name: `createPerson-test-${Date.now()}` } });
  treeId = tree.id;
});
afterAll(() => prisma.$disconnect());

describe('createPerson validation', () => {
  const validData = () => ({ name: 'Alice', birth: 1980, gender: 'F', treeId });

  test('creates a person with valid data', async () => {
    const person = await prisma.$transaction(tx => createPerson(validData(), tx));
    expect(person.name).toBe('Alice');
    expect(person.treeId).toBe(treeId);
  });

  test('throws 400 if name is empty', async () => {
    await expect(
      prisma.$transaction(tx => createPerson({ ...validData(), name: '' }, tx))
    ).rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 if birth out of range', async () => {
    await expect(
      prisma.$transaction(tx => createPerson({ ...validData(), birth: 500 }, tx))
    ).rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 if death < birth', async () => {
    await expect(
      prisma.$transaction(tx => createPerson({ ...validData(), birth: 1980, death: 1970 }, tx))
    ).rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 if gender is invalid', async () => {
    await expect(
      prisma.$transaction(tx => createPerson({ ...validData(), gender: 'X' }, tx))
    ).rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 if treeId is missing', async () => {
    await expect(
      prisma.$transaction(tx => createPerson({ name: 'Alice', birth: 1980, gender: 'F' }, tx))
    ).rejects.toMatchObject({ status: 400 });
  });
});
