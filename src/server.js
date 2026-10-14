const env = require('./config/env');
const { connectDb } = require('./config/db');
const { initModels } = require('./models');
const { createApp } = require('./app');

(async () => {
  await connectDb();
  await initModels();
  createApp().listen(env.port, () => console.log(`API listening on http://localhost:${env.port}`));
})().catch((e) => {
  if (e.name === 'MongooseServerSelectionError' || e.name === 'MongoServerSelectionError') {
    const uri = env.mongoUri;
    const isAtlas = uri.startsWith('mongodb+srv://') || uri.includes('.mongodb.net');
    console.error('Failed to connect to MongoDB.');
    if (isAtlas) {
      console.error('Check that the Atlas cluster is running, your current IP is allowed under Network Access, and the database user credentials in backend/.env are correct.');
      console.error('Atlas Network Access: open https://cloud.mongodb.com/ and go to Security > Network Access > Add IP Address.');
      console.error('For local development, set MONGO_URI=mongodb://127.0.0.1:27017/school_erp?replicaSet=rs0 after starting a local replica set.');
    } else {
      console.error(`Check that MongoDB is running and reachable at the host configured in MONGO_URI (${e.message})`);
    }
  } else {
    console.error('Failed to start:', e.message);
  }
  process.exit(1);
});
