const { ZodError } = require('zod');

const fail = (res, status, message, code, details) =>
  res.status(status).json({ success: false, error: { message, code, ...(details ? { details } : {}) } });

function notFound(req, res) { fail(res, 404, `Route not found: ${req.method} ${req.originalUrl}`, 'NOT_FOUND'); }

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    const details = {};
    err.issues.forEach((i) => { details[i.path.join('.') || '_'] = i.message; });
    return fail(res, 400, 'Validation failed', 'VALIDATION_ERROR', details);
  }
  if (err.name === 'ValidationError' && err.errors) {
    const details = {};
    Object.entries(err.errors).forEach(([k, v]) => { details[k] = v.message; });
    return fail(res, 400, 'Validation failed', 'VALIDATION_ERROR', details);
  }
  if (err.name === 'CastError') return fail(res, 400, `Invalid ${err.path}`, 'INVALID_ID');
  if (err.code === 11000) {
    const fields = Object.keys(err.keyPattern || {}).filter((k) => k !== 'schoolId');
    return fail(res, 409, `Duplicate value for ${fields.join(', ') || 'unique field'}`, 'DUPLICATE', { fields });
  }
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'Malformed JSON body', 'BAD_JSON');
  if (/replica set|Transaction numbers/i.test(err.message || '')) {
    console.error(err);
    return fail(res, 500, 'Database transactions unavailable: MongoDB must run as a replica set (see README).', 'TX_UNAVAILABLE');
  }
  if (err.status && err.code) return fail(res, err.status, err.message, err.code, err.details);
  if (process.env.NODE_ENV !== 'test') console.error(err);
  return fail(res, 500, 'Internal server error', 'INTERNAL');
}

module.exports = { notFound, errorHandler };
