const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Convert a Mongoose doc (optionally populated) to JSON and flatten a populated ref into `as`.
function withRef(doc, field, as) {
  const j = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc };
  const v = j[field];
  const populated = v && typeof v === 'object' && !v._bsontype;
  j[as] = populated ? v : null;
  j[field] = populated ? v.id : v;
  return j;
}

module.exports = { escapeRegex, withRef };
