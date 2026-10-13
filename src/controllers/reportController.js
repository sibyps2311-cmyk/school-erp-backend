const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { sendCsv } = require('../utils/csv');
const { rupees } = require('../utils/money');
const { queryStudents } = require('../services/studentService');
const att = require('../services/attendanceService');
const fees = require('../services/feeService');
const { todayStr } = require('../utils/dates');

const wantsCsv = (q) => q.format === 'csv';
const stamp = () => todayStr();
const label = (st) => ({ unpaid: 'Unpaid', partial: 'Partially Paid', paid: 'Paid' }[st] || st);

const checkRange = (from, to) => { if (from && to && from > to) throw new AppError(400, '"from" must not be after "to"', 'INVALID_RANGE'); };

exports.students = asyncHandler(async (req, res) => {
  const csv = wantsCsv(req.query);
  const { rows, meta, total } = await queryStudents(req.auth, req.query, { paginate: !csv });
  if (csv) {
    const cols = [
      { header: 'Admission No', key: 'admissionNumber' }, { header: 'Name', key: 'name' },
      { header: 'Class', get: (r) => (r.class ? `${r.class.name} - ${r.class.section}` : '') },
      ...(req.auth.role === 'accountant' ? [] : [{ header: 'Gender', key: 'gender' }, { header: 'Date of Birth', key: 'dob' }]),
      { header: 'Guardian', key: 'guardianName' }, { header: 'Phone', key: 'phone' }, { header: 'Admission Date', key: 'admissionDate' },
      { header: 'Status', get: (r) => (r.isActive ? 'Active' : 'Inactive') },
    ];
    return sendCsv(res, `students-${stamp()}.csv`, cols, rows);
  }
  res.json({ success: true, data: rows, meta, totals: { count: total } });
});

exports.attendanceDaily = asyncHandler(async (req, res) => {
  const csv = wantsCsv(req.query);
  const r = await att.attendanceReport(req.auth, req.query, { paginate: !csv, from: req.query.date, to: req.query.date });
  if (csv) {
    return sendCsv(res, `attendance-${req.query.date}.csv`, [
      { header: 'Admission No', key: 'admissionNumber' }, { header: 'Name', key: 'name' }, { header: 'Class', key: 'className' }, { header: 'Status', key: 'status' },
    ], r.rows);
  }
  res.json({ success: true, data: r.rows, meta: r.meta, totals: r.totals });
});

exports.attendanceRange = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) throw new AppError(400, 'from and to are required', 'VALIDATION_ERROR');
  checkRange(from, to);
  const csv = wantsCsv(req.query);
  const r = await att.attendanceReport(req.auth, req.query, { paginate: !csv, from, to });
  if (csv) {
    return sendCsv(res, `attendance-${from}-to-${to}.csv`, [
      { header: 'Admission No', key: 'admissionNumber' }, { header: 'Name', key: 'name' }, { header: 'Class', key: 'className' },
      { header: 'Present', key: 'present' }, { header: 'Absent', key: 'absent' }, { header: 'Marked Days', key: 'markedDays' },
      { header: 'Attendance %', get: (x) => (x.percentage === null ? 'n/a' : x.percentage) },
    ], r.rows);
  }
  res.json({ success: true, data: r.rows, meta: r.meta, totals: r.totals });
});

exports.attendanceStudent = asyncHandler(async (req, res) => {
  checkRange(req.query.from, req.query.to);
  const csv = wantsCsv(req.query);
  const r = await att.studentHistory(req.auth, req.params.id, req.query, { paginate: !csv });
  if (csv) {
    return sendCsv(res, `attendance-${r.student.admissionNumber}.csv`, [
      { header: 'Date', key: 'date' }, { header: 'Status', key: 'status' }, { header: 'Marked By', key: 'markedBy' },
    ], r.rows);
  }
  res.json({ success: true, data: r.rows, meta: r.meta, totals: r.totals, student: r.student });
});

exports.feeCollection = asyncHandler(async (req, res) => {
  checkRange(req.query.from, req.query.to);
  const csv = wantsCsv(req.query);
  const r = await fees.queryPayments(req.auth, req.query, { paginate: !csv });
  if (csv) {
    return sendCsv(res, `fee-collection-${stamp()}.csv`, [
      { header: 'Receipt No', key: 'receiptNumber' }, { header: 'Date', key: 'paidDate' },
      { header: 'Admission No', get: (x) => x.student && x.student.admissionNumber }, { header: 'Student', get: (x) => x.student && x.student.name },
      { header: 'Class', key: 'className' }, { header: 'Fee Category', get: (x) => x.category && x.category.name },
      { header: 'Method', key: 'method' }, { header: 'Amount (INR)', get: (x) => rupees(x.amountPaise) }, { header: 'Received By', key: 'receivedBy' },
    ], r.rows);
  }
  res.json({ success: true, data: r.rows, meta: r.meta, totals: r.totals });
});

exports.feeOutstanding = asyncHandler(async (req, res) => {
  const csv = wantsCsv(req.query);
  const q = { ...req.query, status: req.query.status && req.query.status !== 'paid' ? req.query.status : 'outstanding' };
  const r = await fees.queryDues(req.auth, q, { paginate: !csv });
  if (csv) {
    return sendCsv(res, `outstanding-fees-${stamp()}.csv`, [
      { header: 'Admission No', get: (x) => x.student && x.student.admissionNumber }, { header: 'Student', get: (x) => x.student && x.student.name },
      { header: 'Class', key: 'className' }, { header: 'Fee Category', get: (x) => x.category && x.category.name }, { header: 'Due Date', key: 'dueDate' },
      { header: 'Billed (INR)', get: (x) => rupees(x.amountPaise) }, { header: 'Paid (INR)', get: (x) => rupees(x.paidPaise) },
      { header: 'Outstanding (INR)', get: (x) => rupees(x.outstandingPaise) }, { header: 'Status', get: (x) => label(x.status) }, { header: 'Overdue', get: (x) => (x.isOverdue ? 'Yes' : 'No') },
    ], r.rows);
  }
  res.json({ success: true, data: r.rows, meta: r.meta, totals: r.totals });
});
