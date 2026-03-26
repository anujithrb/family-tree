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
