require('dotenv').config();
const path = require('path');
const express = require('express');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes mounted here in later tasks
app.use('/api', require('./routes/tree'));
app.use('/api/couples', require('./routes/couples'));
app.use('/api/people', require('./routes/people'));

app.use(express.static(path.join(__dirname, '../../')));
app.use(errorHandler);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
}

module.exports = app;
