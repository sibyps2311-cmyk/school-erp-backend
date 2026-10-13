// Starts one in-memory MongoDB *replica set* (payments use transactions). Set TEST_MONGO_URI to use your own replica set instead.
const { MongoMemoryReplSet } = require('mongodb-memory-server');

module.exports = async () => {
  if (process.env.TEST_MONGO_URI) return;
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  global.__REPLSET__ = rs;
  process.env.TEST_MONGO_URI = rs.getUri();
};
