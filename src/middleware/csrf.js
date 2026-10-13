const AppError = require('../utils/AppError');

// Cookie auth => guard state-changing requests. SameSite=Lax cookies + CORS allow-list + this custom header
// (which browsers only let same-origin/allow-listed origins send, via a CORS preflight) blocks CSRF.
module.exports = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'erp-web') {
    return next(new AppError(403, 'Missing X-Requested-With header', 'CSRF_BLOCKED'));
  }
  next();
};
