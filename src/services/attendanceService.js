const mongoose = require('mongoose');
const { Student, Attendance, User } = require('../models');
const { getClassForAccess, assignedClassIds } = require('./access');
const { buildStudentFilter } = require('./studentService');
const { toId } = require('../utils/ids');
const AppError = require('../utils/AppError');
const { pageParams, pageMeta } = require('../utils/pagination');

/**
 * ATTENDANCE PERCENTAGE RULE (documented in README):
 *   percentage = present / (present + absent) * 100
 * Only dates that have a saved record count. An unmarked date is neither present nor absent: it is
 * excluded from numerator AND denominator (treated as "not recorded", e.g. holiday / not yet marked).
 */
const pct = (present, absent) => {
  const marked = present + absent;
  return marked === 0 ? null : Math.round((present / marked) * 10000) / 100;
};

async function bulkMark(auth, { classId, date, records }) {
  const cls = await getClassForAccess(auth, classId);
  const ids = records.map((r) => r.studentId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError(400, 'Duplicate student in request', 'DUPLICATE_STUDENT');
  }
  // every student must be an ACTIVE student of this class in this school
  const valid = await Student.countDocuments({ _id: { $in: ids }, schoolId: auth.schoolId, classId: cls._id, isActive: true });
  if (valid !== ids.length) {
    throw new AppError(400, 'One or more students do not belong to this class', 'STUDENT_CLASS_MISMATCH');
  }
  const ops = records.map((r) => ({
    updateOne: {
      filter: { schoolId: auth.schoolId, studentId: toId(r.studentId), date },
      update: { $set: { status: r.status, classId: cls._id, markedBy: auth.userId } },
      upsert: true,
    },
  }));
  try {
    await Attendance.bulkWrite(ops, { ordered: false });
  } catch (e) {
    if (e.code !== 11000 && !(e.writeErrors || []).every((w) => w.code === 11000)) throw e;
    await Attendance.bulkWrite(ops, { ordered: false }); // concurrent upsert race: retry once, now it updates
  }
  return { saved: records.length };
}

async function sheet(auth, { classId, date }) {
  const cls = await getClassForAccess(auth, classId);
  const students = await Student.find({ schoolId: auth.schoolId, classId: cls._id, isActive: true }).sort({ name: 1 });
  const recs = await Attendance.find({ schoolId: auth.schoolId, classId: cls._id, date, studentId: { $in: students.map((s) => s._id) } });
  const map = new Map(recs.map((r) => [String(r.studentId), r.status]));
  const rows = students.map((s) => ({ studentId: s.id, admissionNumber: s.admissionNumber, name: s.name, status: map.get(String(s._id)) || null }));
  const present = rows.filter((r) => r.status === 'present').length;
  const absent = rows.filter((r) => r.status === 'absent').length;
  return { class: { id: cls.id, name: cls.name, section: cls.section }, date, students: rows, summary: { total: rows.length, present, absent, unmarked: rows.length - present - absent } };
}

// Range / daily report. Students are paginated server-side, stats come from Attendance aggregation.
async function attendanceReport(auth, q, { paginate = true, from, to } = {}) {
  const filter = await buildStudentFilter(auth, { classId: q.classId, search: q.search, isActive: 'true' });
  const { page, limit, skip } = pageParams(q);
  let cursor = Student.find(filter).populate('classId', 'name section').sort({ name: 1, _id: 1 });
  if (paginate) cursor = cursor.skip(skip).limit(limit);
  const [students, allIds] = await Promise.all([cursor, Student.distinct('_id', filter)]);
  const match = (ids) => ({ schoolId: auth.schoolId, studentId: { $in: ids }, date: { $gte: from, $lte: to } });
  const group = { _id: '$studentId', present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } }, absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } } };
  const [pageStats, totalStats] = await Promise.all([
    Attendance.aggregate([{ $match: match(students.map((s) => s._id)) }, { $group: group }]),
    Attendance.aggregate([
      { $match: match(allIds) },
      { $group: { _id: null, present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } }, absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } } } },
    ]),
  ]);
  const byStudent = new Map(pageStats.map((s) => [String(s._id), s]));
  const single = from === to;
  const dayRecs = single ? await Attendance.find(match(students.map((s) => s._id))) : [];
  const dayMap = new Map(dayRecs.map((r) => [String(r.studentId), r.status]));
  const rows = students.map((s) => {
    const st = byStudent.get(String(s._id)) || { present: 0, absent: 0 };
    return {
      studentId: s.id, admissionNumber: s.admissionNumber, name: s.name,
      className: s.classId ? `${s.classId.name} - ${s.classId.section}` : '',
      present: st.present, absent: st.absent, markedDays: st.present + st.absent, percentage: pct(st.present, st.absent),
      ...(single ? { status: dayMap.get(String(s._id)) || 'unmarked' } : {}),
    };
  });
  const t = totalStats[0] || { present: 0, absent: 0 };
  const totalStudents = allIds.length;
  const totals = { students: totalStudents, present: t.present, absent: t.absent, markedRecords: t.present + t.absent, percentage: pct(t.present, t.absent) };
  if (single) totals.unmarked = totalStudents - (t.present + t.absent);
  return { rows, total: totalStudents, totals, meta: pageMeta(page, limit, totalStudents) };
}

async function studentHistory(auth, studentId, q, { paginate = true } = {}) {
  const student = await Student.findOne({ _id: toId(studentId, 'student id'), schoolId: auth.schoolId }).populate('classId', 'name section');
  if (!student) throw new AppError(404, 'Student not found', 'NOT_FOUND');
  if (auth.role === 'teacher') {
    const assigned = await assignedClassIds(auth);
    const cid = student.classId && (student.classId._id || student.classId);
    if (!assigned.some((a) => a.equals(cid))) throw new AppError(403, "You are not assigned to this student's class", 'CLASS_NOT_ASSIGNED');
  }
  const filter = { schoolId: auth.schoolId, studentId: student._id };
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const { page, limit, skip } = pageParams(q);
  let cursor = Attendance.find(filter).sort({ date: -1 });
  if (paginate) cursor = cursor.skip(skip).limit(limit);
  const [recs, total, agg] = await Promise.all([
    cursor, Attendance.countDocuments(filter),
    Attendance.aggregate([{ $match: { ...filter, studentId: student._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const present = (agg.find((a) => a._id === 'present') || { n: 0 }).n;
  const absent = (agg.find((a) => a._id === 'absent') || { n: 0 }).n;
  const markers = await User.find({ _id: { $in: recs.map((r) => r.markedBy) } }).select('name');
  const mName = new Map(markers.map((m) => [String(m._id), m.name]));
  return {
    student: { id: student.id, name: student.name, admissionNumber: student.admissionNumber, class: student.classId ? { id: student.classId.id, name: student.classId.name, section: student.classId.section } : null },
    rows: recs.map((r) => ({ date: r.date, status: r.status, markedBy: mName.get(String(r.markedBy)) || '' })),
    total, totals: { present, absent, markedDays: present + absent, percentage: pct(present, absent) }, meta: pageMeta(page, limit, total),
  };
}

module.exports = { bulkMark, sheet, attendanceReport, studentHistory, pct };
