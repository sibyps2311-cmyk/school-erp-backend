const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { User, Membership, School } = require('../models');

const COOKIE = 'erp_token';
const cookieOptions = () => ({
  httpOnly: true,
  // Vercel and Render use different sites, so production cross-site API
  // requests require SameSite=None. Browsers require Secure with that mode.
  sameSite: env.cookieSecure ? 'none' : 'lax',
  secure: env.cookieSecure,
  path: '/',
});

function signSession(userId, membershipId) {
  return jwt.sign({ sub: String(userId), mid: String(membershipId) }, env.jwtSecret, { expiresIn: `${env.sessionHours}h` });
}

// Authenticates the cookie and resolves the ACTIVE school from the user's membership (never from the client).
const authenticate = asyncHandler(async (req, res, next) => {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
  let payload;
  try { payload = jwt.verify(token, env.jwtSecret); } catch (e) {
    throw new AppError(401, 'Session expired or invalid', 'SESSION_INVALID');
  }
  const membership = await Membership.findOne({ _id: payload.mid, userId: payload.sub, isActive: true });
  if (!membership) throw new AppError(401, 'Session no longer valid', 'SESSION_INVALID');
  const [user, school] = await Promise.all([User.findById(payload.sub), School.findById(membership.schoolId)]);
  if (!user || !user.isActive || !school || !school.isActive) throw new AppError(401, 'Account is inactive', 'SESSION_INVALID');
  req.auth = { userId: user._id, schoolId: membership.schoolId, role: membership.role, membershipId: membership._id, user, school };
  next();
});

const authorize = (...roles) => (req, res, next) => {
  if (!req.auth || !roles.includes(req.auth.role)) {
    return next(new AppError(403, 'You do not have permission to perform this action', 'FORBIDDEN'));
  }
  next();
};

module.exports = { authenticate, authorize, signSession, cookieOptions, COOKIE };
