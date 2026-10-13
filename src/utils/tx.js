const mongoose = require('mongoose');

// Runs fn inside a MongoDB transaction (auto-retries transient errors such as write conflicts).
async function withTx(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } finally {
    await session.endSession();
  }
}
module.exports = { withTx };
