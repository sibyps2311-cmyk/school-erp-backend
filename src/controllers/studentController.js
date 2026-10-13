const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { Student, Class } = require('../models');
const { getInSchool, getClassForAccess } = require('../services/access');
const { queryStudents, studentDto } = require('../services/studentService');

async function assertClassInSchool(auth, classId) {
  const cls = await Class.findOne({ _id: classId, schoolId: auth.schoolId, isActive: true });
  if (!cls) throw new AppError(400, 'Class not found in your school', 'INVALID_CLASS');
}

exports.list = asyncHandler(async (req, res) => {
  const { rows, meta } = await queryStudents(req.auth, req.query);
  res.json({ success: true, data: rows, meta });
});

exports.get = asyncHandler(async (req, res) => {
  const s = await getInSchool(Student, req.auth, req.params.id, 'Student');
  if (req.auth.role === 'teacher') await getClassForAccess(req.auth, s.classId); // 403 if not assigned
  await s.populate('classId', 'name section');
  res.json({ success: true, data: studentDto(s, req.auth.role) });
});

exports.create = asyncHandler(async (req, res) => {
  await assertClassInSchool(req.auth, req.body.classId);
  const s = await Student.create({ ...req.body, schoolId: req.auth.schoolId });
  await s.populate('classId', 'name section');
  res.status(201).json({ success: true, data: studentDto(s, 'admin') });
});

exports.update = asyncHandler(async (req, res) => {
  const s = await getInSchool(Student, req.auth, req.params.id, 'Student');
  if (req.body.classId) await assertClassInSchool(req.auth, req.body.classId);
  Object.assign(s, req.body);
  await s.save();
  await s.populate('classId', 'name section');
  res.json({ success: true, data: studentDto(s, 'admin') });
});

exports.deactivate = asyncHandler(async (req, res) => {
  const s = await getInSchool(Student, req.auth, req.params.id, 'Student');
  s.isActive = false;
  await s.save();
  res.json({ success: true, data: { id: s.id, isActive: false } });
});
