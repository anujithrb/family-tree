// dotenv is loaded by jest.config.js setupFiles — no need to call it here
const prisma = require('../src/lib/prisma');

async function clearDatabase() {
  await prisma.coupleChild.deleteMany();
  await prisma.couple.deleteMany();
  await prisma.person.deleteMany();
}

module.exports = { prisma, clearDatabase };
