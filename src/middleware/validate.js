// validate({ body, query, params }) with zod schemas. Parsed (coerced/trimmed) values replace the originals.
module.exports = (schemas) => (req, res, next) => {
  try {
    if (schemas.params) req.params = schemas.params.parse(req.params);
    if (schemas.query) req.query = schemas.query.parse(req.query);
    if (schemas.body) req.body = schemas.body.parse(req.body);
    next();
  } catch (e) { next(e); }
};
