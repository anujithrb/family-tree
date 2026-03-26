# Edit Person Details + Profile Picture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Edit" context menu action that lets users update a person's name, birth/death years, gender, and profile picture; display the photo in the SVG avatar circle, falling back to the initial letter when absent.

**Architecture:** New `PUT /api/people/:id` route accepts `multipart/form-data` (via `multer`) and persists a new optional `profilePicture` column on `Person`. The frontend reuses the existing modal with an added photo-preview field and a new `'edit'` mode; `renderNodes` conditionally renders an SVG `<image>` element clipped to the avatar circle.

**Tech Stack:** Node.js / Express / Prisma / PostgreSQL / multer / uuid / D3.js v7 / vanilla JS

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/prisma/schema.prisma` | Modify | Add `profilePicture String?` to `Person` |
| `server/package.json` | Modify | Add `multer`, `uuid` dependencies |
| `server/src/middleware/upload.js` | **Create** | multer config: diskStorage, fileFilter (MIME), 2 MB limit |
| `server/src/routes/people.js` | Modify | Add `PUT /:id` route |
| `server/src/index.js` | Modify | Serve `server/uploads/` at `/uploads/` via `express.static` |
| `server/__tests__/people.test.js` | Modify | Add tests for `PUT /api/people/:id` and `GET /api/tree` |
| `index.html` | Modify | Edit button, modal HTML/CSS, modal JS, card avatar rendering |

---

## Task 1: Install Dependencies and Run Schema Migration

**Files:**
- Modify: `server/package.json`
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: Install multer and uuid**

```bash
cd server && npm install multer uuid
```

Expected: `multer` and `uuid` appear in `server/package.json` under `"dependencies"`.

- [ ] **Step 2: Add `profilePicture` to the Person model**

In `server/prisma/schema.prisma`, add `profilePicture String?` after the `gender` line:

```prisma
model Person {
  id             String        @id @default(cuid())
  name           String
  birth          Int
  death          Int?
  gender         String
  profilePicture String?
  spouseAIn      Couple?       @relation("SpouseA")
  spouseBIn      Couple?       @relation("SpouseB")
  childIn        CoupleChild[]
}
```

- [ ] **Step 3: Run the migration and regenerate the Prisma client**

```bash
cd server && npx prisma migrate dev --name add-profile-picture
cd server && npx prisma generate
```

Expected: migration succeeds, `server/prisma/migrations/` contains a new timestamped folder.

- [ ] **Step 4: Verify existing tests still pass**

```bash
cd server && npm test
```

Expected: all existing tests pass (no regressions from schema change).

- [ ] **Step 5: Commit**

```bash
cd server && git add package.json package-lock.json prisma/schema.prisma prisma/migrations/
git commit -m "feat: add profilePicture field to Person schema"
```

---

## Task 2: Create Upload Middleware and Wire Up Static Serving

**Files:**
- Create: `server/src/middleware/upload.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Create the upload middleware**

Create `server/src/middleware/upload.js`:

```js
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Extension is derived from the validated MIME type — never from the client filename
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/gif':  '.gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || '.jpg';
    cb(null, uuidv4() + ext);
  },
});

const fileFilter = (_req, file, cb) => {
  if (MIME_TO_EXT[file.mimetype]) {
    cb(null, true);
  } else {
    const err = new Error('Unsupported file type. Allowed: JPEG, PNG, WEBP, GIF.');
    err.status = 400;
    cb(err);
  }
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
});
```

- [ ] **Step 2: Add `/uploads` static serving to `server/src/index.js`**

After the existing `app.use(express.json())` line and before the routes, add:

```js
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
```

The full top of `index.js` should now read:

```js
require('dotenv').config();
const path = require('path');
const express = require('express');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api', require('./routes/tree'));
app.use('/api/couples', require('./routes/couples'));
app.use('/api/people', require('./routes/people'));

app.use(express.static(path.join(__dirname, '../../')));
app.use(errorHandler);
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/middleware/upload.js server/src/index.js
git commit -m "feat: add multer upload middleware and serve /uploads static directory"
```

---

## Task 3: Backend — PUT /api/people/:id Text Fields (TDD)

**Files:**
- Modify: `server/__tests__/people.test.js`
- Modify: `server/src/routes/people.js`

- [ ] **Step 1: Write failing tests for text-field updates and validation**

Add to `server/__tests__/people.test.js` (append after the existing tests):

```js
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
```

- [ ] **Step 2: Run tests to confirm they fail (route doesn't exist yet)**

```bash
cd server && npm test -- --testPathPattern=people
```

Expected: `PUT /api/people/:id` tests fail with 404 (route not mounted) or similar.

- [ ] **Step 3: Add the PUT route to `server/src/routes/people.js`**

Add these imports at the top of the file (after the existing `require` lines):

```js
const path = require('path');
const fs   = require('fs');
const upload = require('../middleware/upload');
```

Add the PUT route after the DELETE route, before `module.exports`:

```js
router.put('/:id', (req, res, next) => {
  upload.single('profilePicture')(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 2 MB.' });
      }
      if (uploadErr.status === 400) {
        return res.status(400).json({ error: uploadErr.message });
      }
      return next(uploadErr);
    }

    try {
      const { id } = req.params;
      const { name, birth: birthStr, death: deathStr, gender, removePhoto } = req.body;

      const birth = parseInt(birthStr, 10);
      const death = deathStr && deathStr !== '' ? parseInt(deathStr, 10) : null;

      // Helper: clean up any freshly uploaded file if we can't proceed
      const cleanup = () => { if (req.file) fs.unlinkSync(req.file.path); };

      if (!name || !name.trim())
        { cleanup(); return res.status(400).json({ error: 'Name is required.' }); }
      if (!birth || isNaN(birth) || birth < 1000 || birth > 2100)
        { cleanup(); return res.status(400).json({ error: 'Birth year must be between 1000 and 2100.' }); }
      if (death !== null && (isNaN(death) || death < birth))
        { cleanup(); return res.status(400).json({ error: 'Death year must be ≥ birth year.' }); }
      if (!gender || !['M', 'F'].includes(gender))
        { cleanup(); return res.status(400).json({ error: 'Gender is required.' }); }

      const existing = await prisma.person.findUnique({ where: { id } });
      if (!existing) { cleanup(); return res.status(404).json({ error: 'Person not found' }); }

      const UPLOADS_DIR = path.join(__dirname, '../../uploads');
      const absPath = (relUrl) => relUrl
        ? path.join(UPLOADS_DIR, path.basename(relUrl))
        : null;

      let profilePicture = existing.profilePicture;

      if (removePhoto === 'true') {
        // removePhoto wins — ignore any uploaded file, delete old photo
        cleanup();
        const old = absPath(existing.profilePicture);
        if (old && fs.existsSync(old)) fs.unlinkSync(old);
        profilePicture = null;
      } else if (req.file) {
        // New photo: multer already wrote the file — update DB, then delete old
        const newRelPath = `/uploads/${req.file.filename}`;
        const oldRelPath = existing.profilePicture;
        let updated;
        try {
          updated = await prisma.person.update({
            where: { id },
            data: { name: name.trim(), birth, death, gender, profilePicture: newRelPath },
          });
        } catch (dbErr) {
          fs.unlinkSync(req.file.path); // roll back new file
          throw dbErr;
        }
        // DB committed — safe to delete old file
        const old = absPath(oldRelPath);
        if (old && fs.existsSync(old)) fs.unlinkSync(old);
        return res.json(updated);
      }

      const updated = await prisma.person.update({
        where: { id },
        data: { name: name.trim(), birth, death, gender, profilePicture },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
});
```

- [ ] **Step 4: Run tests to confirm text-field tests pass**

```bash
cd server && npm test -- --testPathPattern=people
```

Expected: all `PUT /api/people/:id` text-field tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/people.js server/__tests__/people.test.js
git commit -m "feat: add PUT /api/people/:id for text field updates"
```

---

## Task 4: Backend — PUT /api/people/:id Photo Upload and Edge Cases (TDD)

**Files:**
- Modify: `server/__tests__/people.test.js`

- [ ] **Step 1: Write failing tests for photo upload, MIME type rejection, size limit, removePhoto**

Add inside the `describe('PUT /api/people/:id', ...)` block, after the existing tests there:

```js
  // --- Photo upload tests ---
  // A known-valid 1×1 PNG (67 bytes) encoded as base64
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  let uploadedFiles = [];

  afterEach(() => {
    // Clean up any files created in server/uploads/ during tests
    const uploadsDir = path.join(__dirname, '../uploads');
    if (fs.existsSync(uploadsDir)) {
      fs.readdirSync(uploadsDir).forEach(f => {
        try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (_) {}
      });
    }
    uploadedFiles = [];
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

  test('returns 400 for file exceeding 2 MB', async () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1);
    const res = await request(app)
      .put(`/api/people/${person.id}`)
      .field('name', 'Alice')
      .field('birth', '1980')
      .field('gender', 'F')
      .attach('profilePicture', oversized, { filename: 'big.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
  });
```

Also add the `path` and `fs` imports at the top of `people.test.js`:

```js
const path = require('path');
const fs   = require('fs');
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
cd server && npm test -- --testPathPattern=people
```

Expected: photo-related tests fail (the feature is already partially implemented — the upload, removePhoto, and MIME/size error tests should pass or give meaningful output).

- [ ] **Step 3: Run the full people test suite and verify all tests pass**

```bash
cd server && npm test -- --testPathPattern=people
```

Expected: all tests pass. If any fail, fix the issue in `people.js` before continuing.

- [ ] **Step 4: Run all tests to check for regressions**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Add the GET /api/tree profilePicture test**

Append to `server/__tests__/people.test.js` (outside the `describe` block):

```js
test('GET /api/tree includes profilePicture in person objects', async () => {
  const p1 = await prisma.person.create({ data: { name: 'A', birth: 1900, gender: 'M' } });
  const p2 = await prisma.person.create({ data: { name: 'B', birth: 1902, gender: 'F' } });
  await prisma.couple.create({ data: { spouseAId: p1.id, spouseBId: p2.id } });

  const res = await request(app).get('/api/tree');
  expect(res.status).toBe(200);
  expect(res.body.people[0]).toHaveProperty('profilePicture');
});
```

- [ ] **Step 6: Run tests to confirm tree test passes**

```bash
cd server && npm test -- --testPathPattern=people
```

Expected: all tests pass including the new tree test.

- [ ] **Step 7: Commit**

```bash
git add server/__tests__/people.test.js
git commit -m "test: add photo upload, removePhoto, and validation tests for PUT /api/people/:id"
```

---

## Task 5: Frontend — Edit Button in Context Menu

**Files:**
- Modify: `index.html` (lines 70–76 and ~243–288)

- [ ] **Step 1: Add the Edit button to the context menu HTML**

In `index.html`, find `<div id="ctx-menu">` (around line 70) and add the Edit button as the first child:

```html
<div id="ctx-menu">
  <button id="ctx-edit">Edit</button>
  <button id="ctx-add-spouse">Add Spouse</button>
  <button id="ctx-add-child">Add Child</button>
  <div class="ctx-sep"></div>
  <button id="ctx-remove">Remove</button>
  <div id="ctx-confirm-area"></div>
</div>
```

- [ ] **Step 2: Update the viewport offset guard**

In `showCtxMenu`, change:

```js
const y = Math.min(event.clientY, window.innerHeight - 160);
```

to:

```js
const y = Math.min(event.clientY, window.innerHeight - 200);
```

- [ ] **Step 3: Add the ctxEdit variable and event listener**

After the line `const ctxConfirmArea = document.getElementById('ctx-confirm-area');` (around line 247), add:

```js
const ctxEdit = document.getElementById('ctx-edit');
```

After `ctxAddSpouse.addEventListener(...)` (around line 290), add:

```js
ctxEdit.addEventListener('click', () => {
  if (!ctxTarget) return;
  openModal('edit', ctxTarget);
  hideCtxMenu();
});
```

- [ ] **Step 4: Open the app in a browser and verify the Edit option appears on right-click**

Start the server: `cd server && node src/index.js`
Open `http://localhost:5001`, right-click any person card. Confirm "Edit" appears at the top of the context menu.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add Edit button to person context menu"
```

---

## Task 6: Frontend — Edit Modal HTML and CSS

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add photo upload section to the modal HTML**

In `index.html`, find the `<div id="modal-box">` section. Add the photo upload field as the first element inside the box, directly after `<h2 id="modal-title">`:

```html
<div id="modal-photo-section" style="display:none; margin-bottom:16px;">
  <div style="color:#aaa;font-size:12px;margin-bottom:8px;">Profile photo</div>
  <div style="display:flex;align-items:center;gap:12px;">
    <div id="modal-photo-preview"
         onclick="document.getElementById('modal-photo-input').click()"
         title="Click to upload a photo">
    </div>
    <div>
      <div style="color:#aaa;font-size:11px;line-height:1.5;">
        Click circle to upload<br>JPG, PNG, GIF, WEBP — max 2 MB
      </div>
      <div id="modal-photo-remove" onclick="handleRemovePhoto()">✕ Remove photo</div>
    </div>
  </div>
  <input type="file" id="modal-photo-input" accept="image/jpeg,image/png,image/webp,image/gif"
         style="display:none;">
</div>
```

The full `#modal-box` should now read:

```html
<div id="modal-box">
  <h2 id="modal-title">Add Spouse</h2>
  <div id="modal-photo-section" style="display:none; margin-bottom:16px;">
    <div style="color:#aaa;font-size:12px;margin-bottom:8px;">Profile photo</div>
    <div style="display:flex;align-items:center;gap:12px;">
      <div id="modal-photo-preview"
           onclick="document.getElementById('modal-photo-input').click()"
           title="Click to upload a photo">
      </div>
      <div>
        <div style="color:#aaa;font-size:11px;line-height:1.5;">
          Click circle to upload<br>JPG, PNG, GIF, WEBP — max 2 MB
        </div>
        <div id="modal-photo-remove" onclick="handleRemovePhoto()">✕ Remove photo</div>
      </div>
    </div>
    <input type="file" id="modal-photo-input"
           accept="image/jpeg,image/png,image/webp,image/gif"
           style="display:none;">
  </div>
  <label>Name
    <input type="text" id="modal-name" placeholder="Full name">
  </label>
  <label>Birth year
    <input type="number" id="modal-birth" placeholder="e.g. 1990" min="1000" max="2100">
  </label>
  <label>Death year (optional)
    <input type="number" id="modal-death" placeholder="leave blank if living" min="1000" max="2100">
  </label>
  <label>Gender
    <div class="gender-row">
      <label><input type="radio" name="modal-gender" value="M"> Male</label>
      <label><input type="radio" name="modal-gender" value="F"> Female</label>
    </div>
  </label>
  <div id="modal-error"></div>
  <div class="modal-actions">
    <button class="btn-secondary" id="modal-cancel">Cancel</button>
    <button class="btn-primary"   id="modal-submit">Add</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSS for the photo preview circle and remove link**

In `index.html`, inside the `<style>` block, add after the existing `#modal-error` rule:

```css
#modal-photo-preview {
  width: 52px; height: 52px; border-radius: 50%;
  flex-shrink: 0; overflow: hidden; cursor: pointer;
  border: 2px dashed #555;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; color: #fff;
  background: #444;
}
#modal-photo-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
#modal-photo-remove {
  color: #f08080; font-size: 11px; margin-top: 6px;
  cursor: pointer; display: none;
}
```

- [ ] **Step 3: Verify HTML structure is correct**

Reload the app. Right-click a person → "Edit". Confirm the modal opens (it won't be wired up yet, but structure should be valid). Check browser console for HTML parse errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add photo upload field to edit modal HTML and CSS"
```

---

## Task 7: Frontend — Modal JavaScript Logic

**Files:**
- Modify: `index.html` (the `<script>` section)

- [ ] **Step 1: Add photo state variables**

After `let modalContext = null;` (around line 353), add:

```js
let selectedFile     = null;   // File object chosen by the user, not yet uploaded
let pendingRemovePhoto = false; // true when user has clicked "Remove photo"
```

- [ ] **Step 2: Add updatePhotoPreview and handleRemovePhoto helper functions**

Add these functions before `openModal`:

```js
function updatePhotoPreview() {
  const preview    = document.getElementById('modal-photo-preview');
  const removeLink = document.getElementById('modal-photo-remove');
  const p          = modalContext && modalContext.target && modalContext.target.person;

  preview.innerHTML = '';
  preview.style.background = '';

  if (selectedFile) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(selectedFile);
    preview.appendChild(img);
    removeLink.style.display = 'block';
  } else if (p && p.profilePicture && !pendingRemovePhoto) {
    const img = document.createElement('img');
    img.src = p.profilePicture;
    preview.appendChild(img);
    removeLink.style.display = 'block';
  } else if (p) {
    preview.textContent = p.name[0];
    preview.style.background = C[p.gender].avatar;
    removeLink.style.display = 'none';
  }
}

function handleRemovePhoto() {
  pendingRemovePhoto = true;
  selectedFile = null;
  document.getElementById('modal-photo-input').value = '';
  updatePhotoPreview();
}
```

- [ ] **Step 3: Wire up the file input change handler**

After `document.getElementById('modal-cancel').addEventListener('click', closeModal);`, add:

```js
document.getElementById('modal-photo-input').addEventListener('change', function () {
  if (this.files[0]) {
    selectedFile = this.files[0];
    pendingRemovePhoto = false;
    updatePhotoPreview();
  }
});
```

- [ ] **Step 4: Update openModal to handle 'edit' mode**

Replace the existing `openModal` function with:

```js
function openModal(mode, d) {
  modalContext     = { mode, target: d };
  selectedFile     = null;
  pendingRemovePhoto = false;

  const photoSection = document.getElementById('modal-photo-section');
  const submitBtn    = document.getElementById('modal-submit');

  if (mode === 'edit') {
    const p = d.person;
    modalTitle.textContent   = 'Edit Person';
    submitBtn.textContent    = 'Save';
    modalName.value          = p.name;
    modalBirth.value         = p.birth;
    modalDeath.value         = p.death || '';
    document.querySelectorAll('input[name="modal-gender"]').forEach(r => {
      r.checked = r.value === p.gender;
    });
    photoSection.style.display = 'block';
    updatePhotoPreview();
  } else {
    modalTitle.textContent   = mode === 'spouse' ? 'Add Spouse' : 'Add Child';
    submitBtn.textContent    = 'Add';
    modalName.value          = '';
    modalBirth.value         = '';
    modalDeath.value         = '';
    document.querySelectorAll('input[name="modal-gender"]').forEach(r => r.checked = false);
    photoSection.style.display = 'none';
  }

  modalError.textContent = '';
  modalOverlay.classList.add('open');
  modalName.focus();
}
```

- [ ] **Step 5: Update closeModal to reset state**

Replace the existing `closeModal` function with:

```js
function closeModal() {
  modalOverlay.classList.remove('open');
  modalContext       = null;
  selectedFile       = null;
  pendingRemovePhoto = false;
}
```

- [ ] **Step 6: Add the 'edit' branch to the modalSubmit handler**

Inside the `modalSubmit.addEventListener('click', async () => { ... })` handler, find the `try` block where `mode` is checked. The existing code reads:

```js
let res;
if (mode === 'spouse') {
  res = await fetch('/api/couples', { ... });
} else {
  const coupleId = target.coupleId;
  res = await fetch(`/api/couples/${coupleId}/children`, { ... });
}
```

Replace it with:

```js
let res;
if (mode === 'edit') {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('birth', String(birth));
  if (death !== null) fd.append('death', String(death));
  fd.append('gender', gender);
  if (pendingRemovePhoto) {
    fd.append('removePhoto', 'true');
  } else if (selectedFile) {
    fd.append('profilePicture', selectedFile);
  }
  res = await fetch(`/api/people/${target.person.id}`, { method: 'PUT', body: fd });
} else if (mode === 'spouse') {
  res = await fetch('/api/couples', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ existingPersonId: target.person.id, spouse: personData }),
  });
} else {
  const coupleId = target.coupleId;
  res = await fetch(`/api/couples/${coupleId}/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(personData),
  });
}
```

- [ ] **Step 7: Manual test — edit person details and photo**

With the server running (`cd server && node src/index.js`), open `http://localhost:5001`:
1. Right-click a person → Edit. Confirm the modal opens pre-filled.
2. Change the name → Save. Confirm the card updates.
3. Right-click same person → Edit → click the photo circle → upload an image → Save. Confirm the photo appears in the card.
4. Right-click again → Edit → "✕ Remove photo" → Save. Confirm the initial letter returns.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: wire up edit modal JS — openModal edit mode, photo preview, submit handler"
```

---

## Task 8: Frontend — Card Avatar with Profile Picture

**Files:**
- Modify: `index.html` (`renderNodes` function, around lines 423–506)

- [ ] **Step 1: Add a per-person avatar clipPath**

In `renderNodes`, find the line that adds the card `clipPath`:

```js
groups.append('clipPath')
  .attr('id', d => `clip-${d.person.id}`)
  .append('rect')
  ...
```

Directly after it (before the `const inner = ...` line), add:

```js
// Per-person clipPath for the circular avatar (distinct from the card-level clip)
groups.append('clipPath')
  .attr('id', d => `avatar-clip-${d.person.id}`)
  .append('circle')
  .attr('cx', 22)
  .attr('cy', NODE_H / 2)
  .attr('r', 18);
```

- [ ] **Step 2: Replace the avatar circle + initial text with conditional rendering**

Find the existing avatar section (lines roughly 469–486):

```js
// Avatar circle — append to inner
inner.append('circle')
  .attr('cx', 22)
  ...

// Initial letter in avatar — append to inner
inner.append('text')
  .attr('x', 22)
  ...
  .text(d => d.person.name[0]);
```

Replace those two blocks with:

```js
// Avatar background circle (always rendered — fallback for missing/loading photo)
inner.append('circle')
  .attr('cx', 22)
  .attr('cy', NODE_H / 2)
  .attr('r', 18)
  .attr('fill', d => C[d.person.gender].avatar);

// Initial letter — only when no profile picture
inner.filter(d => !d.person.profilePicture)
  .append('text')
  .attr('x', 22)
  .attr('y', NODE_H / 2)
  .attr('text-anchor', 'middle')
  .attr('dominant-baseline', 'central')
  .attr('fill', '#ffffff')
  .attr('font-size', '15px')
  .attr('font-weight', '700')
  .attr('font-family', 'system-ui, sans-serif')
  .text(d => d.person.name[0]);

// Profile photo — only when available; clipped to the avatar circle
inner.filter(d => !!d.person.profilePicture)
  .append('image')
  .attr('x', 4)               // cx - r = 22 - 18
  .attr('y', NODE_H / 2 - 18) // cy - r = 30 - 18
  .attr('width', 36)           // r * 2
  .attr('height', 36)
  .attr('href', d => d.person.profilePicture)
  .attr('clip-path', d => `url(#avatar-clip-${d.person.id})`)
  .attr('preserveAspectRatio', 'xMidYMid slice');
```

- [ ] **Step 2: Manual test — verify photo appears in card**

With the server running:
1. Open `http://localhost:5001`.
2. Right-click a person → Edit → upload a photo → Save.
3. Confirm the photo appears in the card's avatar circle.
4. Right-click same person → Edit → Remove photo → Save.
5. Confirm the initial letter returns in the avatar circle.
6. Zoom in/out to confirm the photo scales correctly with the SVG transform.

- [ ] **Step 3: Run all backend tests to ensure nothing was broken**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: render profile picture in SVG avatar circle with initial-letter fallback"
```

---

## Done

All features are implemented:
- Right-click → Edit opens a pre-filled modal for all person fields.
- Photo upload with live preview; falls back to initial letter when no photo is set.
- `PUT /api/people/:id` persists text + photo changes; handles removePhoto, MIME filtering, and 2 MB size limit.
- Profile photo renders in the SVG card; the colored circle remains as a fallback.
