# Edit Person Details + Profile Picture

**Date:** 2026-03-26
**Status:** Approved

## Overview

Two related features:
1. **Edit person details** — allow editing an existing person's name, birth year, death year, and gender via a right-click context menu action.
2. **Profile picture** — allow uploading a photo for a person; displayed in the avatar circle on the person card; falls back to the initial letter if no photo is set.

## Backend Changes

### Schema

Add an optional `profilePicture` field to the `Person` model in `server/prisma/schema.prisma`:

```prisma
model Person {
  id             String        @id @default(cuid())
  name           String
  birth          Int
  death          Int?
  gender         String
  profilePicture String?       // relative URL, e.g. "/uploads/abc123.jpg"
  spouseAIn      Couple?       @relation("SpouseA")
  spouseBIn      Couple?       @relation("SpouseB")
  childIn        CoupleChild[]
}
```

Apply the migration with both commands (both are required):

```bash
cd server && npx prisma migrate dev --name add-profile-picture
cd server && npx prisma generate
```

### File Storage

- Uploaded images stored in `server/uploads/` (created if absent).
- Filenames are a UUID + extension derived from the **validated MIME type** (e.g. `image/jpeg` → `.jpg`), never from the client-supplied filename. This prevents extension spoofing (e.g. a file with a `.php` extension uploaded as `image/jpeg` gets stored as `.jpg`).
- `server/uploads/` served as static files at `/uploads/` via `express.static`.
- Max file size: 2 MB. Accepted MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
- `multer` middleware with `diskStorage` and a `fileFilter` callback rejects disallowed MIME types **before the file is written to disk**. (Note: with `diskStorage`, `fileFilter` runs before writing — pass an error from `fileFilter` to prevent the file from landing on disk.)

### New Route

| Method | Path | Purpose |
|--------|------|---------|
| PUT | `/api/people/:id` | Update name, birth, death, gender, and/or profile picture |

**`PUT /api/people/:id`** accepts `multipart/form-data`:

- Text fields: `name` (string), `birth` (integer string), `death` (integer string or empty string), `gender` ("M"/"F")
- File field: `profilePicture` (optional image file)
- Special field: `removePhoto` ("true") — deletes the existing photo file and clears the DB field
- Returns the updated `Person` object (all fields, including `profilePicture`).
- Parse `birth` and `death` with `parseInt` before validation (they arrive as strings from multipart/form-data).
- Validation rules: name required, birth 1000–2100, death ≥ birth (if provided), gender required.
- Returns 404 if no person with `:id` exists.
- Returns 400 on validation failure, disallowed MIME type, or file > 2 MB.

**Mutual exclusivity rule:** If `removePhoto=true` is present, ignore any uploaded file and delete the existing photo. `removePhoto` always wins.

**Photo replacement order (prevents data loss on DB failure):**
1. Write new file to disk.
2. Update DB record.
3. Only after a successful DB commit, delete the old file from disk.

If the DB update fails after the new file is written, the new file is cleaned up (delete it) and an error is returned — the old file remains untouched.

**Note on middleware:** `express.json()` is applied globally in `server/src/index.js`. It silently no-ops on `multipart/form-data` requests, so it does not interfere with the `PUT /api/people/:id` route. Do not add a redundant `express.json()` call inside this route.

### `GET /api/tree`

`prisma.person.findMany()` selects all columns with no explicit field list, so `profilePicture` is included in the response automatically once the schema migration is applied. No code change to `tree.js` is needed.

## Frontend Changes

### Context Menu

Add an **"Edit"** button as the first item in `#ctx-menu` (above "Add Spouse"). It is never disabled.

```html
<button id="ctx-edit">Edit</button>
```

The viewport offset guard on the context menu (`window.innerHeight - 160` in `showCtxMenu`) must be increased to account for the additional button height — update to approximately `window.innerHeight - 190`.

### Edit Modal

Reuse the existing `#modal-overlay` / `#modal-box` structure. Add a new mode `'edit'` alongside the existing `'spouse'` and `'child'` modes.

When mode is `'edit'`:
- Title: `"Edit Person"`
- All fields pre-filled with the current person's data.
- Submit button label: `"Save"`.
- Submit sends `PUT /api/people/:id` as `multipart/form-data` (not JSON).

**`modalSubmit` click handler:** The existing handler branches on `mode === 'spouse'` and `mode === 'child'`. A third `mode === 'edit'` branch must be added that:
- Builds a `FormData` object with all text fields.
- Appends the selected file if one was chosen (and `removePhoto` is not set).
- Appends `removePhoto=true` if the user clicked "Remove photo".
- Sends a `PUT` request to `/api/people/:id`.

**Photo upload field** (new, inserted above the Name field):

- A clickable circle (52px diameter, larger than the 36px card avatar for usability) shows the current photo or the initial letter.
- Clicking the circle opens a hidden `<input type="file" accept="image/*">`.
- On file selection, a `FileReader` reads the file and updates the circle's background as a live preview — no upload occurs until "Save" is clicked.
- A "Remove photo" text link appears when a photo exists (either a saved photo or a newly selected one). It is hidden when no photo is present.
- **UX state machine for "Remove photo":** Clicking "Remove photo" always means "delete whatever photo ends up on the server after save" — it sets a `removePhoto` flag and clears the preview regardless of whether the user had previously selected a new file. The file input is also cleared so no file is submitted. This overrides any prior file selection.

### Card Rendering (`renderNodes`)

In the avatar area (cx=22, cy=30, r=18):

- **If `person.profilePicture` is set:** render an SVG `<image>` element clipped to the avatar circle. Use a per-person `<clipPath>` with id `avatar-clip-{person.id}` (distinct from the existing card-level `clip-{person.id}`). The colored `<circle>` background is still rendered beneath the image so a broken/slow-loading image degrades gracefully to the colored circle.
- **If not set:** render the existing `<circle>` + initial `<text>` (no change).

## Error Handling

- File too large (>2 MB): multer returns an error; backend returns 400 with a clear message; frontend shows it in `#modal-error`.
- Unsupported MIME type: `fileFilter` rejects the file before it hits disk; backend returns 400; frontend shows error.
- Person ID not found: backend returns 404; frontend shows error.
- DB failure during photo replacement: new file is deleted from disk; old file is preserved; error returned to frontend.
- Missing photo file on disk (DB has a path but file is gone): the SVG `<image>` element renders but displays nothing — the colored circle background beneath it remains visible as a fallback.

## Testing

Add tests to `server/__tests__/people.test.js` (using a real PostgreSQL database, no mocks):

- `PUT /api/people/:id` updates text fields (name, birth, death, gender) correctly.
- `PUT /api/people/:id` with a valid image file sets `profilePicture` on the person.
- `PUT /api/people/:id` with `removePhoto=true` clears `profilePicture` and deletes the file from disk.
- `PUT /api/people/:id` with both a file and `removePhoto=true` removes the photo (removePhoto wins; uploaded file is ignored).
- `PUT /api/people/:id` with an unknown ID returns 404.
- `PUT /api/people/:id` with a disallowed MIME type (e.g. `application/pdf`) returns 400 and does not write any file to disk.
- `PUT /api/people/:id` with a file exceeding 2 MB returns 400.
- Validation rejects invalid birth/death years and missing required fields (returns 400).
- `GET /api/tree` includes `profilePicture` in person objects.

**Test cleanup:** Each test that uploads a file must delete the created file from `server/uploads/` in its `afterEach`/`afterAll` block to avoid polluting the directory across test runs.

## Out of Scope

- Cropping or resizing images server-side.
- Multiple photos per person.
- Photo storage in a CDN or object store.
- Bulk edit.
- EXIF metadata stripping (uploaded photos may contain GPS data; this is a known limitation and a conscious deferral).
