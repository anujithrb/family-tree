const multer = require('multer');

function errorHandler(err, req, res, next) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message });
  }
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Unique constraint violation' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
