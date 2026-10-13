const bcrypt = require('bcryptjs');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { User, Membership } = require('../models');
const { signSession, cookieOptions, COOKIE } = require('../middleware/auth');

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // equalises timing for unknown emails

const sessionPayload = (user, school, role) => ({
  user: { id: user.id, name: user.name, email: user.email },
  role,
  school: { id: school.id, name: school.name, code: school.code },
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password, schoolCode } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok || !user.isActive) throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');

  let memberships = await Membership.find({ userId: user._id, isActive: true }).populate('schoolId').sort({ createdAt: 1 });
  memberships = memberships.filter((m) => m.schoolId && m.schoolId.isActive);
  if (schoolCode) memberships = memberships.filter((m) => m.schoolId.code === schoolCode.toUpperCase());
  if (!memberships.length) throw new AppError(403, 'No active school membership for this account', 'NO_MEMBERSHIP');

  const m = memberships[0];
  res.cookie(COOKIE, signSession(user._id, m._id), { ...cookieOptions(), maxAge: env.sessionHours * 3600 * 1000 });
  res.json({ success: true, data: sessionPayload(user, m.schoolId, m.role) });
});

exports.logout = (req, res) => {
  res.clearCookie(COOKIE, cookieOptions());
  res.json({ success: true, data: { loggedOut: true } });
};

exports.me = (req, res) => {
  const { user, school, role } = req.auth;
  res.json({ success: true, data: sessionPayload(user, school, role) });
};
