# Admin Interface & Multi-Tree Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `FamilyTree` model scoping all `Person` records, a `/api/trees` route for creating and listing trees, and an `admin.html` page with a card grid and 3-step creation wizard.

**Architecture:** `treeId` is added as a required FK on `Person`; `Couple` is unchanged and its tree is inferred from its spouses. A new `trees.js` route handles `GET/POST /api/trees`; existing routes gain a required `?treeId=` query param for filtering. `admin.html` is a standalone page; `index.html` reads `?treeId=` from its URL and passes it on all fetches.

**Tech Stack:** PostgreSQL · Prisma ORM · Express.js · Vanilla JS (no framework) · supertest (tests)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `server/prisma/schema.prisma` | Add `FamilyTree` model, add `treeId` to `Person` |
| Create | `server/prisma/migrations/YYYYMMDDHHMMSS_add_family_tree/migration.sql` | Custom SQL: create table, backfill "Demo Tree", add FK |
| Modify | `server/src/lib/createPerson.js` | Accept `treeId` param, pass to `person.create` |
| Create | `server/src/routes/trees.js` | `GET /api/trees`, `POST /api/trees` |
| Modify | `server/src/routes/tree.js` | Require `?treeId=`, filter data, return `treeName` |
| Modify | `server/src/routes/couples.js` | Inherit `treeId` from existing person / couple spouses |
| Modify | `server/src/index.js` | Mount `trees.js` route |
| Create | `server/__tests__/trees.test.js` | Tests for new trees routes |
| Modify | `server/__tests__/tree.test.js` | Add `treeId` to direct Prisma inserts, pass `?treeId=` |
| Modify | `server/__tests__/couples.test.js` | Add `treeId` to direct Prisma inserts, pass `?treeId=` |
| Modify | `server/__tests__/people.test.js` | Add `treeId` to direct Prisma inserts |
| Modify | `index.html` | Read `?treeId=`, pass to fetches, show tree name, add admin link |
| Create | `admin.html` | Card grid dashboard + 3-step creation wizard |

---

## Task 1: Schema migration — add FamilyTree and treeId

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: custom migration SQL file

- [ ] **Step 1: Update schema.prisma**

Replace the `Person` model and add `FamilyTree` model. The full updated schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model FamilyTree {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  people    Person[]
}

model Person {
  id             String        @id @default(cuid())
  name           String
  birth          Int?
  death          Int?
  gender         String
  profilePicture String?
  treeId         String
  tree           FamilyTree    @relation(fields: [treeId], references: [id])
  spouseAIn      Couple?       @relation("SpouseA")
  spouseBIn      Couple?       @relation("SpouseB")
  childIn        CoupleChild[]
}

model Couple {
  id        String        @id @default(cuid())
  spouseA   Person        @relation("SpouseA", fields: [spouseAId], references: [id])
  spouseAId String        @unique
  spouseB   Person        @relation("SpouseB", fields: [spouseBId], references: [id])
  spouseBId String        @unique
  children  CoupleChild[]
}

model CoupleChild {
  couple    Couple  @relation(fields: [coupleId], references: [id], onDelete: Cascade)
  coupleId  String
  child     Person  @relation(fields: [childId], references: [id])
  childId   String
  sortOrder Int     @default(0)

  @@id([coupleId, childId])
}
```

- [ ] **Step 2: Create the migration file with --create-only**

```bash
npm --prefix server exec -- prisma migrate dev --create-only --name add_family_tree
```

This creates a new file under `server/prisma/migrations/` without applying it. Note the exact directory name printed (format: `YYYYMMDDHHMMSS_add_family_tree`).

- [ ] **Step 3: Replace the generated migration SQL**

Open the generated `migration.sql` file and replace its entire contents with this custom SQL that creates the table, inserts the Demo Tree, backfills existing rows, then removes the column default:

```sql
-- CreateTable
CREATE TABLE "FamilyTree" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FamilyTree_pkey" PRIMARY KEY ("id")
);

-- Insert seed Demo Tree with a known ID
INSERT INTO "FamilyTree" ("id", "name") VALUES ('demo-tree-seed-id', 'Demo Tree');

-- Add treeId column with a temporary default pointing to Demo Tree
ALTER TABLE "Person" ADD COLUMN "treeId" TEXT NOT NULL DEFAULT 'demo-tree-seed-id';

-- Add foreign key constraint
ALTER TABLE "Person" ADD CONSTRAINT "Person_treeId_fkey"
    FOREIGN KEY ("treeId") REFERENCES "FamilyTree"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop the default — new rows must supply treeId explicitly
ALTER TABLE "Person" ALTER COLUMN "treeId" DROP DEFAULT;
```

- [ ] **Step 4: Apply the migration**

```bash
npm --prefix server exec -- prisma migrate dev
```

Expected output: `The following migration(s) have been applied: ...add_family_tree`

- [ ] **Step 5: Regenerate the Prisma client**

```bash
npm --prefix server exec -- prisma generate
```

Expected output: `Generated Prisma Client`

- [ ] **Step 6: Commit**

```bash
git -C /c/Users/ACER/Projects/claude/family-tree add server/prisma/schema.prisma server/prisma/migrations/
git -C /c/Users/ACER/Projects/claude/family-tree commit -m "feat: add FamilyTree model and treeId to Person with Demo Tree backfill"
```

---

## Task 2: Update createPerson to accept treeId

**Files:**
- Modify: `server/src/lib/createPerson.js`

- [ ] **Step 1: Update createPerson to receive and use treeId**

Replace the file contents:

```js
async function createPerson(data, tx) {
  const { name, birth, death, gender, treeId } = data;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }
  if (birth !== undefined && birth !== null) {
    if (!Number.isInteger(birth) || birth < 1000 || birth > 2100) {
      const err = new Error('birth must be an integer between 1000 and 2100');
      err.status = 400;
      throw err;
    }
  }
  if (death !== undefined && death !== null) {
    if (!Number.isInteger(death) || death < 1000 || death > 2100) {
      const err = new Error('death must be an integer between 1000 and 2100');
      err.status = 400;
      throw err;
    }
    if (birth !== undefined && birth !== null && death < birth) {
      const err = new Error('death must be an integer >= birth year');
      err.status = 400;
      throw err;
    }
  }
  if (gender !== 'M' && gender !== 'F') {
    const err = new Error('gender must be "M" or "F"');
    err.status = 400;
    throw err;
  }
  if (!treeId || typeof treeId !== 'string') {
    const err = new Error('treeId is required');
    err.status = 400;
    throw err;
  }

  return tx.person.create({
    data: { name: name.trim(), birth, death: death ?? null, gender, treeId },
  });
}

module.exports = { createPerson };
```

- [ ] **Step 2: Run existing createPerson tests to confirm they still pass**

```bash
npm --prefix server exec -- jest __tests__/createPerson.test.js --forceExit
```

Expected: tests fail because `treeId` is now required but the existing tests don't supply it. That's expected — we'll fix those tests in Task 6. Move on.

- [ ] **Step 3: Commit**

```bash
git -C /c/Users/ACER/Projects/claude/family-tree add server/src/lib/createPerson.js
git -C /c/Users/ACER/Projects/claude/family-tree commit -m "feat: add treeId param to createPerson"
```

---

## Task 3: Implement /api/trees route (TDD)

**Files:**
- Create: `server/__tests__/trees.test.js`
- Create: `server/src/routes/trees.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/trees.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm --prefix server exec -- jest __tests__/trees.test.js --forceExit
```

Expected: all tests fail — routes don't exist yet.

- [ ] **Step 3: Create the trees route**

Create `server/src/routes/trees.js`:

```js
const { Router } = require('express');
const prisma = require('../lib/prisma');
const { createPerson } = require('../lib/createPerson');

const router = Router();

// GET /api/trees
router.get('/', async (req, res, next) => {
  try {
    const trees = await prisma.familyTree.findMany({ orderBy: { createdAt: 'desc' } });

    const result = await Promise.all(trees.map(async tree => {
      const people = await prisma.person.findMany({ where: { treeId: tree.id } });
      const personIds = people.map(p => p.id);
      const childIds = new Set(
        (await prisma.coupleChild.findMany({ where: { childId: { in: personIds } } }))
          .map(cc => cc.childId)
      );
      const nonChildIds = personIds.filter(id => !childIds.has(id));
      const rootCouple = await prisma.couple.findFirst({
        where: { spouseAId: { in: nonChildIds } },
        include: { spouseA: true, spouseB: true },
      });

      return {
        id: tree.id,
        name: tree.name,
        createdAt: tree.createdAt,
        rootCouple: rootCouple
          ? { spouseA: rootCouple.spouseA.name, spouseB: rootCouple.spouseB.name }
          : null,
      };
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/trees
router.post('/', async (req, res, next) => {
  try {
    const { name, spouseA, spouseB, children = [] } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!spouseA || typeof spouseA !== 'object') {
      return res.status(400).json({ error: 'spouseA is required' });
    }
    if (!spouseB || typeof spouseB !== 'object') {
      return res.status(400).json({ error: 'spouseB is required' });
    }

    const tree = await prisma.$transaction(async tx => {
      const familyTree = await tx.familyTree.create({ data: { name: name.trim() } });

      const personA = await createPerson({ ...spouseA, treeId: familyTree.id }, tx);
      const personB = await createPerson({ ...spouseB, treeId: familyTree.id }, tx);

      const couple = await tx.couple.create({
        data: { spouseAId: personA.id, spouseBId: personB.id },
      });

      for (let i = 0; i < children.length; i++) {
        const child = await createPerson({ ...children[i], treeId: familyTree.id }, tx);
        await tx.coupleChild.create({
          data: { coupleId: couple.id, childId: child.id, sortOrder: i },
        });
      }

      return familyTree;
    });

    res.status(201).json(tree);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount the route in index.js**

In `server/src/index.js`, add the trees route before the existing routes:

```js
app.use('/api/trees', require('./routes/trees'));
app.use('/api', require('./routes/tree'));
app.use('/api/couples', require('./routes/couples'));
app.use('/api/people', require('./routes/people'));
app.use('/api/relationship', require('./routes/relationship'));
```

- [ ] **Step 5: Run trees tests — POST and GET /api/trees should pass, GET /api/tree tests will still fail**

```bash
npm --prefix server exec -- jest __tests__/trees.test.js --forceExit
```

Expected: POST and GET /api/trees tests pass; the `GET /api/tree with treeId filter` group fails because the route isn't updated yet.

- [ ] **Step 6: Commit**

```bash
git -C /c/Users/ACER/Projects/claude/family-tree add server/src/routes/trees.js server/src/index.js
git -C /c/Users/ACER/Projects/claude/family-tree commit -m "feat: add GET and POST /api/trees route"
```

---

## Task 4: Update GET /api/tree to filter by treeId

**Files:**
- Modify: `server/src/routes/tree.js`

- [ ] **Step 1: Replace tree.js with treeId-scoped version**

```js
const { Router } = require('express');
const prisma = require('../lib/prisma');

const router = Router();

router.get('/tree', async (req, res, next) => {
  try {
    const { treeId } = req.query;
    if (!treeId) return res.status(400).json({ error: 'treeId query param is required' });

    const familyTree = await prisma.familyTree.findUnique({ where: { id: treeId } });
    if (!familyTree) return res.status(400).json({ error: 'Unknown treeId' });

    const people = await prisma.person.findMany({ where: { treeId } });
    const personIds = people.map(p => p.id);

    const couplesRaw = await prisma.couple.findMany({
      where: { spouseAId: { in: personIds } },
      include: { children: { orderBy: { sortOrder: 'asc' } } },
    });

    // Sort so the root couple (neither spouse is a child anywhere) comes first
    const childIds = new Set(couplesRaw.flatMap(c => c.children.map(cc => cc.childId)));
    const rootIdx = couplesRaw.findIndex(
      c => !childIds.has(c.spouseAId) && !childIds.has(c.spouseBId)
    );
    const sorted = rootIdx > 0
      ? [couplesRaw[rootIdx], ...couplesRaw.filter((_, i) => i !== rootIdx)]
      : couplesRaw;

    const couples = sorted.map(c => ({
      id: c.id,
      spouseA: c.spouseAId,
      spouseB: c.spouseBId,
      children: c.children.map(cc => cc.childId),
    }));

    res.json({ treeName: familyTree.name, people, couples });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 2: Run trees tests — all groups should now pass**

```bash
npm --prefix server exec -- jest __tests__/trees.test.js --forceExit
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git -C /c/Users/ACER/Projects/claude/family-tree add server/src/routes/tree.js
git -C /c/Users/ACER/Projects/claude/family-tree commit -m "feat: scope GET /api/tree by treeId query param"
```

---

## Task 5: Update couples route to inherit treeId

**Files:**
- Modify: `server/src/routes/couples.js`

- [ ] **Step 1: Replace couples.js**

`POST /api/couples` inherits `treeId` from the existing person. `POST /api/couples/:id/children` inherits `treeId` from the couple's spouseA. Both validate `?treeId=` matches:

```js
const { Router } = require('express');
const prisma = require('../lib/prisma');
const { createPerson } = require('../lib/createPerson');

const router = Router();

// POST /api/couples?treeId=X
router.post('/', async (req, res, next) => {
  try {
    const { treeId } = req.query;
    if (!treeId) return res.status(400).json({ error: 'treeId query param is required' });

    const { existingPersonId, spouse } = req.body;

    const existing = await prisma.person.findUnique({ where: { id: existingPersonId } });
    if (!existing) return res.status(404).json({ error: 'Person not found' });
    if (existing.treeId !== treeId) return res.status(400).json({ error: 'Person does not belong to this tree' });

    const inCouple = await prisma.couple.findFirst({
      where: { OR: [{ spouseAId: existingPersonId }, { spouseBId: existingPersonId }] },
    });
    if (inCouple) return res.status(409).json({ error: 'Person already belongs to a couple' });

    const couple = await prisma.$transaction(async tx => {
      const newSpouse = await createPerson({ ...spouse, treeId: existing.treeId }, tx);
      return tx.couple.create({ data: { spouseAId: existingPersonId, spouseBId: newSpouse.id } });
    });

    res.status(201).json(couple);
  } catch (err) {
    next(err);
  }
});

// POST /api/couples/:id/children?treeId=X
router.post('/:id/children', async (req, res, next) => {
  try {
    const { treeId } = req.query;
    if (!treeId) return res.status(400).json({ error: 'treeId query param is required' });

    const couple = await prisma.couple.findUnique({
      where: { id: req.params.id },
      include: { children: true, spouseA: true },
    });
    if (!couple) return res.status(404).json({ error: 'Couple not found' });
    if (couple.spouseA.treeId !== treeId) return res.status(400).json({ error: 'Couple does not belong to this tree' });

    const child = await prisma.$transaction(async tx => {
      const person = await createPerson({ ...req.body, treeId: couple.spouseA.treeId }, tx);
      await tx.coupleChild.create({
        data: { coupleId: couple.id, childId: person.id, sortOrder: couple.children.length },
      });
      return person;
    });

    res.status(201).json(child);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git -C /c/Users/ACER/Projects/claude/family-tree add server/src/routes/couples.js
git -C /c/Users/ACER/Projects/claude/family-tree commit -m "feat: inherit treeId in couples and children routes"
```

---

## Task 6: Fix existing test files

**Files:**
- Modify: `server/__tests__/tree.test.js`
- Modify: `server/__tests__/couples.test.js`
- Modify: `server/__tests__/people.test.js`
- Modify: `server/__tests__/createPerson.test.js`

- [ ] **Step 1: Fix createPerson.test.js**

Read the file first, then update every `createPerson(data, tx)` call to include `treeId`. Since `createPerson` is called inside a transaction in tests, you need a real `treeId`. Add a `beforeAll` to create a tree and use its id:

```js
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
```

- [ ] **Step 2: Fix tree.test.js**

Replace the file. The `beforeEach(clearDatabase)` stays. Every `prisma.person.create()` needs `treeId`. Use a single tree created in `beforeAll`:

```js
const request = require('supertest');
const app = require('../src/index');
const { prisma, clearDatabase } = require('./helpers');

let treeId;
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
```

- [ ] **Step 3: Fix couples.test.js**

Replace the file. `beforeEach(clearDatabase)` stays. Add `treeId` to all `prisma.person.create()` calls and `?treeId=` to all route calls:

```js
const request = require('supertest');
const app = require('../src/index');
const { prisma, clearDatabase } = require('./helpers');

let treeId;
beforeAll(async () => {
  const tree = await prisma.familyTree.create({ data: { name: `couples-test-${Date.now()}` } });
  treeId = tree.id;
});
beforeEach(clearDatabase);
afterAll(() => prisma.$disconnect());

// ── POST /api/couples ──────────────────────────────────────────
describe('POST /api/couples', () => {
  test('creates couple and new spouse person', async () => {
    const person = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });

    const res = await request(app)
      .post(`/api/couples?treeId=${treeId}`)
      .send({ existingPersonId: person.id, spouse: { name: 'Helen', birth: 1938, gender: 'F' } });

    expect(res.status).toBe(201);
    expect(res.body.spouseAId).toBe(person.id);
    expect(res.body.spouseBId).toBeDefined();

    const newSpouse = await prisma.person.findUnique({ where: { id: res.body.spouseBId } });
    expect(newSpouse.name).toBe('Helen');
    expect(newSpouse.treeId).toBe(treeId);
  });

  test('returns 400 when treeId param is missing', async () => {
    const person = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
    const res = await request(app)
      .post('/api/couples')
      .send({ existingPersonId: person.id, spouse: { name: 'Helen', birth: 1938, gender: 'F' } });
    expect(res.status).toBe(400);
  });

  test('returns 404 for unknown existingPersonId', async () => {
    const res = await request(app)
      .post(`/api/couples?treeId=${treeId}`)
      .send({ existingPersonId: 'does-not-exist', spouse: { name: 'Helen', birth: 1938, gender: 'F' } });
    expect(res.status).toBe(404);
  });

  test('returns 409 if person already in a couple as spouseA', async () => {
    const p1 = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
    const p2 = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F', treeId } });
    await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });

    const res = await request(app)
      .post(`/api/couples?treeId=${treeId}`)
      .send({ existingPersonId: p1.id, spouse: { name: 'Jane', birth: 1940, gender: 'F' } });
    expect(res.status).toBe(409);
  });

  test('returns 409 if person already in a couple as spouseB', async () => {
    const p1 = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
    const p2 = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F', treeId } });
    await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });

    const res = await request(app)
      .post(`/api/couples?treeId=${treeId}`)
      .send({ existingPersonId: p2.id, spouse: { name: 'Jane', birth: 1940, gender: 'M' } });
    expect(res.status).toBe(409);
  });

  test('returns 400 for invalid spouse data', async () => {
    const person = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
    const res = await request(app)
      .post(`/api/couples?treeId=${treeId}`)
      .send({ existingPersonId: person.id, spouse: { name: '', birth: 1938, gender: 'F' } });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/couples/:id/children ────────────────────────────
describe('POST /api/couples/:id/children', () => {
  async function makeCouple() {
    const p1 = await prisma.person.create({ data: { name: 'Thomas', birth: 1935, gender: 'M', treeId } });
    const p2 = await prisma.person.create({ data: { name: 'Helen',  birth: 1938, gender: 'F', treeId } });
    return prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });
  }

  test('adds child and returns person', async () => {
    const couple = await makeCouple();
    const res = await request(app)
      .post(`/api/couples/${couple.id}/children?treeId=${treeId}`)
      .send({ name: 'James', birth: 1962, gender: 'M' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('James');
    expect(res.body.treeId).toBe(treeId);

    const link = await prisma.coupleChild.findFirst({ where: { coupleId: couple.id } });
    expect(link).toBeTruthy();
    expect(link.sortOrder).toBe(0);
  });

  test('returns 400 when treeId param is missing', async () => {
    const couple = await makeCouple();
    const res = await request(app)
      .post(`/api/couples/${couple.id}/children`)
      .send({ name: 'James', birth: 1962, gender: 'M' });
    expect(res.status).toBe(400);
  });

  test('sortOrder increments for each subsequent child', async () => {
    const couple = await makeCouple();
    await request(app).post(`/api/couples/${couple.id}/children?treeId=${treeId}`).send({ name: 'James', birth: 1962, gender: 'M' });
    await request(app).post(`/api/couples/${couple.id}/children?treeId=${treeId}`).send({ name: 'Susan', birth: 1965, gender: 'F' });

    const links = await prisma.coupleChild.findMany({
      where: { coupleId: couple.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(links[0].sortOrder).toBe(0);
    expect(links[1].sortOrder).toBe(1);
  });

  test('returns 404 for unknown couple', async () => {
    const res = await request(app)
      .post(`/api/couples/does-not-exist/children?treeId=${treeId}`)
      .send({ name: 'James', birth: 1962, gender: 'M' });
    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid child data', async () => {
    const couple = await makeCouple();
    const res = await request(app)
      .post(`/api/couples/${couple.id}/children?treeId=${treeId}`)
      .send({ name: 'James', birth: 500, gender: 'M' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Fix people.test.js — add treeId to all person.create calls**

Read the current `people.test.js` first, then add a `beforeAll` that creates a tree and update every `prisma.person.create()` call to include `treeId`. The routes `DELETE /api/people/:id` and `PUT /api/people/:id` don't change — no `?treeId=` needed there.

Pattern to follow (apply to all `prisma.person.create` calls in the file):
```js
// Before
await prisma.person.create({ data: { name: 'Alice', birth: 1980, gender: 'F' } });
// After
await prisma.person.create({ data: { name: 'Alice', birth: 1980, gender: 'F', treeId } });
```

Add at the top of the file (after imports):
```js
let treeId;
beforeAll(async () => {
  const tree = await prisma.familyTree.create({ data: { name: `people-test-${Date.now()}` } });
  treeId = tree.id;
});
```

- [ ] **Step 5: Run full test suite**

```bash
npm --prefix server test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git -C /c/Users/ACER/Projects/claude/family-tree add server/__tests__/
git -C /c/Users/ACER/Projects/claude/family-tree commit -m "test: update all test files to supply treeId after schema migration"
```

---

## Task 7: Update index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Read treeId from URL and guard on missing**

Find the `init()` function in `index.html` (around line 818). Just before the `fetch('/api/tree')` call, add the `treeId` read. Replace:

```js
async function init() {
  // Save viewport position across re-renders
  const prevTransform = (svg && zoom) ? d3.zoomTransform(svg.node()) : null;

  // Fetch tree data
  const res = await fetch('/api/tree');
```

With:

```js
async function init() {
  // Save viewport position across re-renders
  const prevTransform = (svg && zoom) ? d3.zoomTransform(svg.node()) : null;

  // Read treeId from URL
  const treeId = new URLSearchParams(window.location.search).get('treeId');
  if (!treeId) {
    document.body.innerHTML = '<div style="display:flex;height:100vh;align-items:center;justify-content:center;flex-direction:column;gap:12px;font:16px system-ui,sans-serif;color:#aaa;background:#0f1117"><p>No tree selected.</p><a href="admin.html" style="color:#6ab0f5">← Return to Admin</a></div>';
    return;
  }

  // Fetch tree data
  const res = await fetch(`/api/tree?treeId=${treeId}`);
```

- [ ] **Step 2: Add treeId to all other fetch calls**

Find and replace these three fetch calls in `index.html`:

```js
// Line ~555 — add spouse
res = await fetch('/api/couples', {
```
→
```js
res = await fetch(`/api/couples?treeId=${new URLSearchParams(window.location.search).get('treeId')}`, {
```

```js
// Line ~562 — add child
res = await fetch(`/api/couples/${coupleId}/children`, {
```
→
```js
res = await fetch(`/api/couples/${coupleId}/children?treeId=${new URLSearchParams(window.location.search).get('treeId')}`, {
```

To avoid repeating the URL parse, declare `const treeId` at the top of the script (outside `init()`). Find the section where global variables are declared (around line 100, where `let people`, `let couples`, etc. are declared) and add:

```js
const treeId = new URLSearchParams(window.location.search).get('treeId');
```

Then remove the `const treeId` declaration inside `init()` (added in Step 1) since it is now a global, and simplify the three fetch calls to use the top-level `treeId`.

- [ ] **Step 3: Show tree name in page title and add ← Admin link**

Find where `data` is used after the fetch (around line 826):
```js
const data = await res.json();
people  = data.people;
couples = data.couples;
```

Update to:
```js
const data = await res.json();
people  = data.people;
couples = data.couples;
document.title = data.treeName ? `${data.treeName} — Family Tree` : 'Family Tree';
```

Add an "← Admin" link to the page. Find the `#hint` div in the HTML (around line 16):
```html
<div id="hint">Right-click a person to edit · scroll to zoom · drag to pan</div>
```

Add just before it:
```html
<a id="admin-link" href="admin.html" style="position:fixed;top:14px;left:16px;color:#6ab0f5;font:13px system-ui,sans-serif;text-decoration:none;z-index:50;">← Admin</a>
```

- [ ] **Step 4: Verify in browser**

Start the server: `node server/src/index.js`

Open `http://localhost:5001/index.html` — should show the "No tree selected" error with an admin link.

Open `http://localhost:5001/index.html?treeId=demo-tree-seed-id` — should load the Demo Tree (assuming seed data exists with `treeId` set by migration).

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/ACER/Projects/claude/family-tree add index.html
git -C /c/Users/ACER/Projects/claude/family-tree commit -m "feat: scope index.html to treeId query param, add admin back link"
```

---

## Task 8: Create admin.html

**Files:**
- Create: `admin.html`

- [ ] **Step 1: Create admin.html**

Create `/c/Users/ACER/Projects/claude/family-tree/admin.html` with the following full content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Family Tree Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f1117; color: #fff; font: 14px/1.5 system-ui, sans-serif; min-height: 100vh; padding: 32px 24px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 24px; }

    /* Card grid */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
    .card {
      background: #1a1d27; border: 1px solid #333; border-radius: 10px;
      padding: 18px; display: flex; flex-direction: column; gap: 8px;
    }
    .card-new {
      border: 2px dashed #444; align-items: center; justify-content: center;
      cursor: pointer; min-height: 130px; color: #666; font-size: 13px; gap: 6px;
      transition: border-color 0.15s, color 0.15s;
    }
    .card-new:hover { border-color: #6ab0f5; color: #6ab0f5; }
    .card-new .plus { font-size: 28px; line-height: 1; }
    .card-name { font-weight: 600; font-size: 15px; }
    .card-couple { color: #aaa; font-size: 12px; }
    .card-date { color: #555; font-size: 11px; }
    .card-view {
      margin-top: auto; padding: 6px 12px; background: #2a2d3a; border: 1px solid #444;
      border-radius: 6px; color: #6ab0f5; font: inherit; font-size: 12px;
      cursor: pointer; text-align: center; text-decoration: none; display: block;
      transition: background 0.15s;
    }
    .card-view:hover { background: #333; }

    /* Modal overlay */
    #modal-overlay {
      display: none; position: fixed; inset: 0; z-index: 200;
      background: rgba(0,0,0,0.65); align-items: center; justify-content: center;
    }
    #modal-overlay.open { display: flex; }
    #modal-box {
      background: #1a1d27; border: 1px solid #333; border-radius: 10px;
      padding: 28px; width: 100%; max-width: 540px; position: relative;
      font: 14px/1.5 system-ui, sans-serif; color: #fff;
      max-height: 90vh; overflow-y: auto;
    }
    #modal-close {
      position: absolute; top: 12px; right: 14px; background: none; border: none;
      color: #aaa; font-size: 20px; cursor: pointer; line-height: 1; padding: 0;
    }
    #modal-close:hover { color: #fff; }

    /* Step indicator */
    .steps { display: flex; gap: 4px; margin-bottom: 20px; align-items: center; font-size: 12px; color: #555; }
    .steps .step { padding: 3px 10px; border-radius: 12px; background: #2a2d3a; }
    .steps .step.active { background: #2a4a7a; color: #6ab0f5; }
    .steps .step.done { background: #1a3a2a; color: #4a9; }
    .steps .sep { color: #444; }

    /* Form elements */
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 12px; color: #aaa; margin-bottom: 5px; }
    .field input, .field select {
      width: 100%; padding: 8px 10px; background: #0f1117; border: 1px solid #444;
      border-radius: 6px; color: #fff; font: inherit; outline: none;
    }
    .field input:focus, .field select:focus { border-color: #6ab0f5; }
    .spouse-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 480px) { .spouse-grid { grid-template-columns: 1fr; } }

    /* Step 3 layout */
    .step3-wrap { display: grid; grid-template-columns: 1fr; gap: 16px; }
    @media (min-width: 560px) { .step3-wrap { grid-template-columns: 1fr 1fr; } }

    /* Mini preview */
    .preview-box {
      background: #111; border: 1px solid #2a2a2a; border-radius: 8px;
      padding: 14px; display: flex; flex-direction: column; align-items: center; gap: 8px;
      min-height: 120px;
    }
    .preview-label { font-size: 10px; color: #555; letter-spacing: 0.08em; text-transform: uppercase; }
    .preview-couple { display: flex; align-items: center; gap: 6px; }
    .preview-card {
      border-radius: 5px; padding: 5px 10px; font-size: 11px; text-align: center; min-width: 72px;
    }
    .preview-card.male { background: #1e3a5f; }
    .preview-card.female { background: #3d1f2e; }
    .preview-card .gender-label { font-size: 9px; color: #aaa; margin-bottom: 2px; }
    .preview-card .person-name { font-weight: 500; word-break: break-word; }
    .preview-line { width: 24px; height: 2px; background: #444; }
    .preview-vline { width: 2px; height: 12px; background: #444; }
    .preview-hbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center; }

    /* Child rows */
    .child-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
    .child-row input, .child-row select { flex: 1; min-width: 0; }
    .child-row .remove-btn {
      background: none; border: none; color: #666; font-size: 16px; cursor: pointer;
      padding: 0 4px; line-height: 1; flex-shrink: 0;
    }
    .child-row .remove-btn:hover { color: #f08080; }

    /* Buttons */
    .btn-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
    button.btn {
      padding: 8px 18px; border: none; border-radius: 6px; font: inherit;
      cursor: pointer; font-size: 13px;
    }
    button.btn-primary { background: #2a4a7a; color: #6ab0f5; }
    button.btn-primary:hover { background: #2f5490; }
    button.btn-secondary { background: #2a2d3a; color: #aaa; }
    button.btn-secondary:hover { background: #333; }
    button.btn-add {
      width: 100%; padding: 7px; background: #1a1d27; border: 1px dashed #444;
      border-radius: 6px; color: #666; font: inherit; font-size: 12px; cursor: pointer;
      margin-bottom: 10px;
    }
    button.btn-add:hover { border-color: #6ab0f5; color: #6ab0f5; }
    .error-msg { color: #f08080; font-size: 12px; margin-top: 8px; min-height: 16px; }
  </style>
</head>
<body>
  <h1>Family Tree Admin</h1>
  <div class="grid" id="tree-grid">
    <div class="card card-new" id="new-card" onclick="openWizard()">
      <div class="plus">+</div>
      <div>New Tree</div>
    </div>
  </div>

  <!-- Modal -->
  <div id="modal-overlay">
    <div id="modal-box">
      <button id="modal-close" type="button" onclick="closeWizard()">✕</button>

      <div class="steps">
        <div class="step" id="step-ind-1">1. Name</div>
        <div class="sep">›</div>
        <div class="step" id="step-ind-2">2. Root Couple</div>
        <div class="sep">›</div>
        <div class="step" id="step-ind-3">3. Children</div>
      </div>

      <!-- Step 1 -->
      <div id="step-1">
        <h2 style="font-size:16px;margin-bottom:16px">Name your tree</h2>
        <div class="field">
          <label>Tree name *</label>
          <input type="text" id="tree-name" placeholder="e.g. The Rajan Family" autocomplete="off"/>
        </div>
        <div class="error-msg" id="err-1"></div>
        <div class="btn-row">
          <button class="btn btn-secondary" type="button" onclick="closeWizard()">Cancel</button>
          <button class="btn btn-primary" type="button" onclick="goStep(2)">Next →</button>
        </div>
      </div>

      <!-- Step 2 -->
      <div id="step-2" style="display:none">
        <h2 style="font-size:16px;margin-bottom:16px">Root couple</h2>
        <div class="spouse-grid">
          <div>
            <div style="font-size:12px;color:#aaa;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em">Spouse A</div>
            <div class="field"><label>Full name *</label><input type="text" id="spouseA-name" placeholder="Name" autocomplete="off"/></div>
            <div class="field"><label>Birth year *</label><input type="number" id="spouseA-birth" placeholder="e.g. 1960" min="1000" max="2100"/></div>
            <div class="field">
              <label>Gender *</label>
              <select id="spouseA-gender"><option value="M">Male</option><option value="F">Female</option></select>
            </div>
          </div>
          <div>
            <div style="font-size:12px;color:#aaa;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em">Spouse B</div>
            <div class="field"><label>Full name *</label><input type="text" id="spouseB-name" placeholder="Name" autocomplete="off"/></div>
            <div class="field"><label>Birth year *</label><input type="number" id="spouseB-birth" placeholder="e.g. 1963" min="1000" max="2100"/></div>
            <div class="field">
              <label>Gender *</label>
              <select id="spouseB-gender"><option value="F">Female</option><option value="M">Male</option></select>
            </div>
          </div>
        </div>
        <div class="error-msg" id="err-2"></div>
        <div class="btn-row">
          <button class="btn btn-secondary" type="button" onclick="goStep(1)">← Back</button>
          <button class="btn btn-primary" type="button" onclick="goStep(3)">Next →</button>
        </div>
      </div>

      <!-- Step 3 -->
      <div id="step-3" style="display:none">
        <h2 style="font-size:16px;margin-bottom:16px">Add children <span style="color:#555;font-weight:400;font-size:13px">(optional)</span></h2>
        <div class="step3-wrap">
          <div>
            <div id="children-list"></div>
            <button class="btn-add" type="button" onclick="addChildRow()">+ Add Child</button>
          </div>
          <div class="preview-box" id="preview-box">
            <div class="preview-label">Preview</div>
            <div id="preview-content"></div>
          </div>
        </div>
        <div class="error-msg" id="err-3"></div>
        <div class="btn-row">
          <button class="btn btn-secondary" type="button" onclick="goStep(2)">← Back</button>
          <button class="btn btn-primary" type="button" id="create-btn" onclick="createTree()">Create Tree</button>
        </div>
      </div>
    </div>
  </div>

<script>
  // ── State ──────────────────────────────────────────────────────
  let currentStep = 1;
  let childCounter = 0;

  // ── Init ──────────────────────────────────────────────────────
  async function loadTrees() {
    const res = await fetch('/api/trees');
    if (!res.ok) return;
    const trees = await res.json();
    trees.forEach(t => prependCard(t));
  }

  function prependCard(tree) {
    const grid = document.getElementById('tree-grid');
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.treeId = tree.id;
    const couple = tree.rootCouple
      ? `${tree.rootCouple.spouseA} & ${tree.rootCouple.spouseB}`
      : '—';
    const date = new Date(tree.createdAt).toLocaleDateString();
    card.innerHTML = `
      <div class="card-name">${escHtml(tree.name)}</div>
      <div class="card-couple">${escHtml(couple)}</div>
      <div class="card-date">${date}</div>
      <a class="card-view" href="index.html?treeId=${tree.id}">View Tree →</a>
    `;
    grid.insertBefore(card, grid.children[1]);
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Wizard ────────────────────────────────────────────────────
  function openWizard() {
    currentStep = 1;
    document.getElementById('modal-overlay').classList.add('open');
    showStep(1);
    document.getElementById('tree-name').focus();
  }

  function closeWizard() {
    document.getElementById('modal-overlay').classList.remove('open');
    resetWizard();
  }

  function resetWizard() {
    ['tree-name','spouseA-name','spouseB-name','spouseA-birth','spouseB-birth'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('spouseA-gender').value = 'M';
    document.getElementById('spouseB-gender').value = 'F';
    document.getElementById('children-list').innerHTML = '';
    childCounter = 0;
    ['err-1','err-2','err-3'].forEach(id => document.getElementById(id).textContent = '');
    renderPreview();
  }

  function showStep(n) {
    [1, 2, 3].forEach(i => {
      document.getElementById(`step-${i}`).style.display = i === n ? '' : 'none';
      const ind = document.getElementById(`step-ind-${i}`);
      ind.className = 'step' + (i === n ? ' active' : i < n ? ' done' : '');
    });
    currentStep = n;
  }

  function goStep(n) {
    if (n > currentStep && !validateStep(currentStep)) return;
    showStep(n);
    if (n === 3) renderPreview();
  }

  function validateStep(n) {
    const err = id => document.getElementById(id);
    if (n === 1) {
      const name = document.getElementById('tree-name').value.trim();
      if (!name) { err('err-1').textContent = 'Tree name is required.'; return false; }
      err('err-1').textContent = '';
      return true;
    }
    if (n === 2) {
      const aName = document.getElementById('spouseA-name').value.trim();
      const bName = document.getElementById('spouseB-name').value.trim();
      const aBirth = document.getElementById('spouseA-birth').value;
      const bBirth = document.getElementById('spouseB-birth').value;
      if (!aName || !bName) { err('err-2').textContent = 'Both spouse names are required.'; return false; }
      if (!aBirth || !bBirth) { err('err-2').textContent = 'Both birth years are required.'; return false; }
      err('err-2').textContent = '';
      return true;
    }
    return true;
  }

  // ── Children ──────────────────────────────────────────────────
  function addChildRow() {
    const id = ++childCounter;
    const list = document.getElementById('children-list');
    const row = document.createElement('div');
    row.className = 'child-row';
    row.dataset.childId = id;
    row.innerHTML = `
      <input type="text" placeholder="Name" oninput="renderPreview()" data-field="name" autocomplete="off"/>
      <input type="number" placeholder="Year" min="1000" max="2100" style="max-width:72px" oninput="renderPreview()" data-field="birth"/>
      <select oninput="renderPreview()" data-field="gender">
        <option value="M">M</option><option value="F">F</option>
      </select>
      <button class="remove-btn" type="button" onclick="removeChild(this)" title="Remove">✕</button>
    `;
    list.appendChild(row);
    row.querySelector('[data-field="name"]').focus();
    renderPreview();
  }

  function removeChild(btn) {
    btn.closest('.child-row').remove();
    renderPreview();
  }

  function getChildren() {
    return Array.from(document.querySelectorAll('.child-row')).map(row => ({
      name: row.querySelector('[data-field="name"]').value.trim(),
      birth: parseInt(row.querySelector('[data-field="birth"]').value, 10) || null,
      gender: row.querySelector('[data-field="gender"]').value,
    }));
  }

  // ── Mini preview ──────────────────────────────────────────────
  function renderPreview() {
    const aName = (document.getElementById('spouseA-name')?.value || '').trim() || 'Spouse A';
    const bName = (document.getElementById('spouseB-name')?.value || '').trim() || 'Spouse B';
    const aGender = document.getElementById('spouseA-gender')?.value || 'M';
    const bGender = document.getElementById('spouseB-gender')?.value || 'F';
    const children = getChildren();

    let html = `
      <div class="preview-couple">
        <div class="preview-card ${aGender === 'M' ? 'male' : 'female'}">
          <div class="gender-label">${aGender === 'M' ? 'M' : 'F'}</div>
          <div class="person-name">${escHtml(aName.split(' ')[0])}</div>
        </div>
        <div class="preview-line"></div>
        <div class="preview-card ${bGender === 'M' ? 'male' : 'female'}">
          <div class="gender-label">${bGender === 'M' ? 'M' : 'F'}</div>
          <div class="person-name">${escHtml(bName.split(' ')[0])}</div>
        </div>
      </div>`;

    if (children.length > 0) {
      html += `<div class="preview-vline"></div><div class="preview-hbar">`;
      children.forEach(c => {
        const name = c.name || '?';
        const cls = c.gender === 'F' ? 'female' : 'male';
        html += `<div class="preview-card ${cls}">
          <div class="gender-label">${c.gender}</div>
          <div class="person-name">${escHtml(name.split(' ')[0] || '?')}</div>
        </div>`;
      });
      html += `</div>`;
    }

    document.getElementById('preview-content').innerHTML = html;
  }

  // ── Create tree ───────────────────────────────────────────────
  async function createTree() {
    if (!validateStep(3)) return;

    const btn = document.getElementById('create-btn');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    const children = getChildren().filter(c => c.name);

    const payload = {
      name: document.getElementById('tree-name').value.trim(),
      spouseA: {
        name: document.getElementById('spouseA-name').value.trim(),
        birth: parseInt(document.getElementById('spouseA-birth').value, 10),
        gender: document.getElementById('spouseA-gender').value,
      },
      spouseB: {
        name: document.getElementById('spouseB-name').value.trim(),
        birth: parseInt(document.getElementById('spouseB-birth').value, 10),
        gender: document.getElementById('spouseB-gender').value,
      },
      children,
    };

    try {
      const res = await fetch('/api/trees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Request failed');

      // Re-fetch the full tree entry (we need rootCouple names)
      const listRes = await fetch('/api/trees');
      const list = await listRes.json();
      const newTree = list.find(t => t.id === body.id);
      if (newTree) prependCard(newTree);

      closeWizard();
    } catch (err) {
      document.getElementById('err-3').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Tree';
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────
  loadTrees();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify in browser**

Start the server: `node server/src/index.js`

Open `http://localhost:5001/admin.html` and verify:
- The page loads showing the `+` card
- Clicking `+` opens the 3-step wizard
- Step 1 → 2 → 3 navigation works; Back works
- Adding children updates the live preview
- Submitting creates a tree and adds a card to the grid
- Clicking "View Tree →" opens `index.html?treeId=<id>` and renders the tree correctly

- [ ] **Step 3: Commit**

```bash
git -C /c/Users/ACER/Projects/claude/family-tree add admin.html
git -C /c/Users/ACER/Projects/claude/family-tree commit -m "feat: add admin.html with card grid and 3-step tree creation wizard"
```

---

## Final check

- [ ] **Run full test suite one last time**

```bash
npm --prefix server test
```

Expected: all tests pass, no failures.

- [ ] **Final commit if any loose files**

```bash
git -C /c/Users/ACER/Projects/claude/family-tree status
```

Commit any uncommitted changes before wrapping up.
