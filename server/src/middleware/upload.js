const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (err) {
  console.error('Failed to create uploads directory:', err.message);
  throw err;
}

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
    const ext = MIME_TO_EXT[file.mimetype]; // always defined: fileFilter already validated
    cb(null, randomUUID() + ext);
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
