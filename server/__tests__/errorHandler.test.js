const multer = require('multer');
const errorHandler = require('../src/middleware/errorHandler');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

test('uses err.status when set', () => {
  const err = Object.assign(new Error('bad input'), { status: 400 });
  const res = makeRes();
  errorHandler(err, {}, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: 'bad input' });
});

test('maps Prisma P2002 to 409', () => {
  const err = Object.assign(new Error('unique'), { code: 'P2002' });
  const res = makeRes();
  errorHandler(err, {}, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(409);
});

test('maps Prisma P2025 to 404', () => {
  const err = Object.assign(new Error('not found'), { code: 'P2025' });
  const res = makeRes();
  errorHandler(err, {}, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(404);
});

test('maps unknown errors to 500', () => {
  const err = new Error('boom');
  const res = makeRes();
  errorHandler(err, {}, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(500);
});

test('maps MulterError LIMIT_FILE_SIZE to 413', () => {
  const err = new multer.MulterError('LIMIT_FILE_SIZE');
  const res = makeRes();
  errorHandler(err, {}, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(413);
  expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
});

test('maps other MulterError codes to 400', () => {
  const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
  const res = makeRes();
  errorHandler(err, {}, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
});
