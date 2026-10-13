const bcrypt = require('bcryptjs');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { User, Membership, Class } = require('../models');
const { toId } = require('../utils/ids');
const { withTx } = require('../utils/tx');
const { escapeRegex } = require('../utils/misc');
const { pageParams, pageMeta } = require('../utils/pagination');

async function dtos(auth, memberships) {
  const userIds = memberships.map((m) => m.userId._id);
  const classes = await Class.find({ schoolId: auth.schoolId, teacherIds: { $in: userIds } }).select('name section teacherIds');
  return memberships.map((m) => ({
    id: m.userId.id, membershipId: m.id, name: m.userId.name, email: m.userId.email, phone: m.userId.phone,
    isActive: m.isActive && m.userId.isActive,
    classes: classes.filter((c) => c.teacherIds.some((t) => t.equals(m.userId._id))).map((c) => ({ id: c.id, name: c.name, section: c.section })),
  }));
}

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { schoolId: req.auth.schoolId, role: 'teacher' };
  if (req.query.isActive !== 'all') filter.isActive = req.query.isActive !== 'false';
  if (req.query.search) {
    const r = new RegExp(escapeRegex(req.query.search), 'i');
    const ids = await User.find({ $or: [{ name: r }, { email: r }] }).distinct('_id');
    filter.userId = { $in: ids };
  }
  const [ms, total] = await Promise.all([
    Membership.find(filter).populate('userId').sort({ createdAt: 1 }).skip(skip).limit(limit),
    Membership.countDocuments(filter),
  ]);
  res.json({ success: true, data: await dtos(req.auth, ms.filter((m) => m.userId)), meta: pageMeta(page, limit, total) });
});

exports.create = asyncHandler(async (req, res) => {
  const { password, ...rest } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  const m = await withTx(async (session) => {
    const [user] = await User.create([{ ...rest, passwordHash }], { session });
    const [mem] = await Membership.create([{ userId: user._id, schoolId: req.auth.schoolId, role: 'teacher' }], { session });
    return mem;
  });
  const populated = await Membership.findById(m._id).populate('userId');
  res.status(201).json({ success: true, data: (await dtos(req.auth, [populated]))[0] });
});

exports.update = asyncHandler(async (req, res) => {
  // the teacher must hold a teacher membership in the caller's school
  const m = await Membership.findOne({ userId: toId(req.params.id, 'teacher id'), schoolId: req.auth.schoolId, role: 'teacher' }).populate('userId');
  if (!m) throw new AppError(404, 'Teacher not found', 'NOT_FOUND');
  const { name, phone, isActive, password } = req.body;
  if (name !== undefined) m.userId.name = name;
  if (phone !== undefined) m.userId.phone = phone;
  if (password) m.userId.passwordHash = await bcrypt.hash(password, 10);
  await m.userId.save();
  if (isActive !== undefined) {
    m.isActive = isActive; // access is revoked per school by deactivating the membership
    await m.save();
    if (!isActive) await Class.updateMany({ schoolId: req.auth.schoolId }, { $pull: { teacherIds: m.userId._id } });
  }
  res.json({ success: true, data: (await dtos(req.auth, [m]))[0] });
});
