async function createPerson(data, tx) {
  const { name, birth, death, gender } = data;

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

  return tx.person.create({
    data: { name: name.trim(), birth, death: death ?? null, gender },
  });
}

module.exports = { createPerson };
