const { Student } = require('../models');
const { assignedClassIds, getClassForAccess } = require('./access');
const { toId } = require('../utils/ids');
const { escapeRegex, withRef } = require('../utils/misc');
const { pageParams, pageMeta } = require('../utils/pagination');

// Role-aware shape: accountants only get the identity/class/contact data needed for billing.
function studentDto(doc, role) {
  const j = withRef(doc, 'classId', 'class');
  if (role === 'accountant') { delete j.dob; delete j.gender; }
  return j;
}

async function buildStudentFilter(auth, q) {
  const filter = { schoolId: auth.schoolId };
  const assigned = await assignedClassIds(auth);
  if (q.classId) {
    await getClassForAccess(auth, q.classId);
    filter.classId = toId(q.classId);
  } else if (assigned) {
    filter.classId = { $in: assigned };
  }
  if (q.isActive !== 'all') filter.isActive = q.isActive !== 'false';
  if (q.gender) filter.gender = q.gender;
  if (q.search) {
    const r = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: r }, { admissionNumber: r }, { guardianName: r }];
  }
  return filter;
}

async function queryStudents(auth, q, { paginate = true } = {}) {
  const filter = await buildStudentFilter(auth, q);
  const { page, limit, skip } = pageParams(q);
  let cursor = Student.find(filter).populate('classId', 'name section').sort({ name: 1, _id: 1 });
  if (paginate) cursor = cursor.skip(skip).limit(limit);
  const [docs, total] = await Promise.all([cursor, Student.countDocuments(filter)]);
  return { rows: docs.map((d) => studentDto(d, auth.role)), total, meta: pageMeta(page, limit, total) };
}

module.exports = { studentDto, queryStudents, buildStudentFilter };
