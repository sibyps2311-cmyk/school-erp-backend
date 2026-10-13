const mongoose = require('mongoose');

// Global: expose `id` instead of `_id`/`__v` in JSON, never leak passwordHash.
mongoose.plugin((schema) => {
  schema.set('toJSON', {
    transform: (doc, ret) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      delete ret.passwordHash;
      return ret;
    },
  });
});
