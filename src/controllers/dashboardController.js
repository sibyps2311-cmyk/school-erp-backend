const asyncHandler = require('../utils/asyncHandler');
const { Student, Membership, Class, Attendance, FeeDue, Payment } = require('../models');
const { assignedClassIds } = require('../services/access');
const { pct } = require('../services/attendanceService');
const { todayStr, addDays } = require('../utils/dates');
const fees = require('../services/feeService');

async function feeTotals(schoolId) {
  const [collected, dues, overdue] = await Promise.all([
    Payment.aggregate([{ $match: { schoolId } }, { $group: { _id: null, sum: { $sum: '$amountPaise' }, n: { $sum: 1 } } }]),
    FeeDue.aggregate([{ $match: { schoolId } }, { $group: { _id: null, billed: { $sum: '$amountPaise' }, paid: { $sum: '$paidPaise' } } }]),
    FeeDue.countDocuments({ schoolId, status: { $in: ['unpaid', 'partial'] }, dueDate: { $lt: todayStr() } }),
  ]);
  const d = dues[0] || { billed: 0, paid: 0 };
  return { collectedPaise: collected[0] ? collected[0].sum : 0, paymentCount: collected[0] ? collected[0].n : 0, billedPaise: d.billed, outstandingPaise: d.billed - d.paid, overdueDues: overdue };
}

async function attendanceFor(schoolId, classIds, from, to) {
  const match = { schoolId, date: { $gte: from, $lte: to } };
  if (classIds) match.classId = { $in: classIds };
  const rows = await Attendance.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const present = (rows.find((r) => r._id === 'present') || { n: 0 }).n;
  const absent = (rows.find((r) => r._id === 'absent') || { n: 0 }).n;
  return { present, absent, marked: present + absent, percentage: pct(present, absent) };
}

exports.get = asyncHandler(async (req, res) => {
  const { schoolId, role } = req.auth;
  const today = todayStr();

  if (role === 'admin') {
    const [students, teachers, classes, attendanceToday, f] = await Promise.all([
      Student.countDocuments({ schoolId, isActive: true }),
      Membership.countDocuments({ schoolId, role: 'teacher', isActive: true }),
      Class.countDocuments({ schoolId, isActive: true }),
      attendanceFor(schoolId, null, today, today), feeTotals(schoolId),
    ]);
    return res.json({ success: true, data: { role, date: today, students, teachers, classes, attendanceToday: { ...attendanceToday, unmarked: Math.max(0, students - attendanceToday.marked) }, fees: f } });
  }

  if (role === 'teacher') {
    const ids = await assignedClassIds(req.auth);
    const classes = await Class.find({ schoolId, _id: { $in: ids } }).sort({ name: 1, section: 1 });
    const [counts, todayAtt, last30, perClass] = await Promise.all([
      Student.aggregate([{ $match: { schoolId, classId: { $in: ids }, isActive: true } }, { $group: { _id: '$classId', n: { $sum: 1 } } }]),
      attendanceFor(schoolId, ids, today, today), attendanceFor(schoolId, ids, addDays(today, -29), today),
      Attendance.aggregate([{ $match: { schoolId, classId: { $in: ids }, date: today } }, { $group: { _id: { c: '$classId', s: '$status' }, n: { $sum: 1 } } }]),
    ]);
    const cMap = new Map(counts.map((c) => [String(c._id), c.n]));
    const classRows = classes.map((c) => {
      const present = (perClass.find((p) => String(p._id.c) === String(c._id) && p._id.s === 'present') || { n: 0 }).n;
      const absent = (perClass.find((p) => String(p._id.c) === String(c._id) && p._id.s === 'absent') || { n: 0 }).n;
      const total = cMap.get(String(c._id)) || 0;
      return { id: c.id, label: `${c.name} - ${c.section}`, students: total, presentToday: present, absentToday: absent, unmarkedToday: Math.max(0, total - present - absent) };
    });
    return res.json({ success: true, data: { role, date: today, assignedClasses: classRows.length, students: classRows.reduce((a, c) => a + c.students, 0), attendanceToday: todayAtt, attendanceLast30Days: last30, classes: classRows } });
  }

  // accountant
  const [f, recent] = await Promise.all([
    feeTotals(schoolId),
    Payment.find({ schoolId }).sort({ paidAt: -1, _id: -1 }).limit(8).populate('studentId', 'name admissionNumber').populate('categoryId', 'name').populate('classId', 'name section').populate('receivedBy', 'name'),
  ]);
  res.json({ success: true, data: { role, date: today, fees: f, recentPayments: recent.map(fees.paymentDto) } });
});
