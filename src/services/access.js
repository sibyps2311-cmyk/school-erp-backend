const AppError = require('../utils/AppError');
const { toId } = require('../utils/ids');
const { Class } = require('../models');

// Teachers: ids of their assigned classes. Admin/accountant: null (= every class in the school).
async function assignedClassIds(auth) {
  if (auth.role !== 'teacher') return null;
  return Class.find({ schoolId: auth.schoolId, teacherIds: auth.userId, isActive: true }).distinct('_id');
}

// Loads a class from the caller's school (404 for other schools' ids) and enforces teacher assignment (403).
async function getClassForAccess(auth, classId) {
  const cls = await Class.findOne({ _id: toId(classId, 'classId'), schoolId: auth.schoolId });
  if (!cls) throw new AppError(404, 'Class not found', 'NOT_FOUND');
  if (auth.role === 'teacher' && !cls.teacherIds.some((t) => t.equals(auth.userId))) {
    throw new AppError(403, 'You are not assigned to this class', 'CLASS_NOT_ASSIGNED');
  }
  return cls;
}

async function getInSchool(Model, auth, id, label) {
  const doc = await Model.findOne({ _id: toId(id, `${label} id`), schoolId: auth.schoolId });
  if (!doc) throw new AppError(404, `${label} not found`, 'NOT_FOUND');
  return doc;
}

module.exports = { assignedClassIds, getClassForAccess, getInSchool };
