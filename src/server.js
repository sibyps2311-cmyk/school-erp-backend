const env = require('./config/env');
const { connectDb } = require('./config/db');
const { initModels } = require('./models');
const { createApp } = require('./app');

(async () => {
  await connectDb();
  await initModels();
  createApp().listen(env.port, () => console.log(`API listening on http://localhost:${env.port}`));
})().catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
