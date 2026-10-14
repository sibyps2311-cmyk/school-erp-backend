// Starts one in-memory MongoDB replica set (payments use transactions).
// Keep WiredTiger files in this workspace so tests work when the Windows temp
// drive is full. Set TEST_MONGO_URI to use an existing test replica set.
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const path = require('node:path');
const fs = require('node:fs');

module.exports = async () => {
  if (process.env.TEST_MONGO_URI) return;
  const dbPath = path.join(__dirname, '..', '.test-data', `mongo-${process.pid}`);
  fs.mkdirSync(dbPath, { recursive: true });
  const rs = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  global.__REPLSET__ = rs;
  process.env.TEST_MONGO_URI = rs.getUri();
};
