const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { Class, Student, User, Membership } = require('../models');
const { assignedClassIds, getInSchool } = require('../services/access');

async function classDtos(auth, classes) {
  const ids = classes.map((c) => c._id);
  const teacherIds = [...new Set(classes.flatMap((c) => c.teacherIds.map(String)))];
  const [counts, teachers] = await Promise.all([
    Student.aggregate([{ $match: { schoolId: auth.schoolId, classId: { $in: ids }, isActive: true } }, { $group: { _id: '$classId', n: { $sum: 1 } } }]),
    User.find({ _id: { $in: teacherIds } }).select('name'),
  ]);
  const cMap = new Map(counts.map((c) => [String(c._id), c.n]));
  const tMap = new Map(teachers.map((t) => [String(t._id), t.name]));
  return classes.map((c) => ({
    ...c.toJSON(), label: `${c.name} - ${c.section}`, studentCount: cMap.get(String(c._id)) || 0,
    teachers: c.teacherIds.map((t) => ({ id: String(t), name: tMap.get(String(t)) || 'Unknown' })),
  }));
}

exports.list = asyncHandler(async (req, res) => {
  const filter = { schoolId: req.auth.schoolId };
  const assigned = await assignedClassIds(req.auth);
  if (assigned) filter._id = { $in: assigned };
  if (req.query.all !== 'true') filter.isActive = true;
  const classes = await Class.find(filter).sort({ name: 1, section: 1 });
  res.json({ success: true, data: await classDtos(req.auth, classes) });
});

exports.create = asyncHandler(async (req, res) => {
  const cls = await Class.create({ ...req.body, schoolId: req.auth.schoolId }); // schoolId always from membership
  res.status(201).json({ success: true, data: (await classDtos(req.auth, [cls]))[0] });
});

exports.update = asyncHandler(async (req, res) => {
  const cls = await getInSchool(Class, req.auth, req.params.id, 'Class');
  if (req.body.isActive === false) {
    const n = await Student.countDocuments({ schoolId: req.auth.schoolId, classId: cls._id, isActive: true });
    if (n > 0) throw new AppError(409, 'Cannot deactivate a class that still has active students', 'CLASS_HAS_STUDENTS');
  }
  Object.assign(cls, req.body);
  await cls.save();
  res.json({ success: true, data: (await classDtos(req.auth, [cls]))[0] });
});

exports.setTeachers = asyncHandler(async (req, res) => {
  const cls = await getInSchool(Class, req.auth, req.params.id, 'Class');
  const ids = [...new Set(req.body.teacherIds)];
  // every teacher must hold an ACTIVE teacher membership in THIS school
  const valid = await Membership.countDocuments({ schoolId: req.auth.schoolId, role: 'teacher', isActive: true, userId: { $in: ids } });
  if (valid !== ids.length) throw new AppError(400, 'One or more teachers do not belong to this school', 'INVALID_TEACHER');
  cls.teacherIds = ids;
  await cls.save();
  res.json({ success: true, data: (await classDtos(req.auth, [cls]))[0] });
});
