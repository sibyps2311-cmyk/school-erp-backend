const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { FeeCategory, FeeDue, Student } = require('../models');
const { getInSchool } = require('../services/access');
const { toId } = require('../utils/ids');
const fees = require('../services/feeService');
const { z } = require('zod');
const v = require('../validators');

exports.listCategories = asyncHandler(async (req, res) => {
  const filter = { schoolId: req.auth.schoolId };
  if (req.query.all !== 'true') filter.isActive = true;
  res.json({ success: true, data: await FeeCategory.find(filter).sort({ name: 1 }) });
});
exports.createCategory = asyncHandler(async (req, res) => {
  const c = await FeeCategory.create({ ...req.body, schoolId: req.auth.schoolId });
  res.status(201).json({ success: true, data: c });
});
exports.updateCategory = asyncHandler(async (req, res) => {
  const c = await getInSchool(FeeCategory, req.auth, req.params.id, 'Fee category');
  Object.assign(c, req.body);
  await c.save();
  res.json({ success: true, data: c });
});

exports.listDues = asyncHandler(async (req, res) => {
  const { rows, meta, totals } = await fees.queryDues(req.auth, req.query);
  res.json({ success: true, data: rows, meta, totals });
});

// Student + category are re-validated against the caller's school before a due is created.
async function loadStudentAndCategory(auth, studentId, categoryId) {
  const [student, category] = await Promise.all([
    Student.findOne({ _id: toId(studentId, 'studentId'), schoolId: auth.schoolId, isActive: true }),
    FeeCategory.findOne({ _id: toId(categoryId, 'categoryId'), schoolId: auth.schoolId, isActive: true }),
  ]);
  if (!student) throw new AppError(400, 'Active student not found in your school', 'INVALID_STUDENT');
  if (!category) throw new AppError(400, 'Active fee category not found in your school', 'INVALID_CATEGORY');
  return { student, category };
}

exports.createDue = asyncHandler(async (req, res) => {
  const { student } = await loadStudentAndCategory(req.auth, req.body.studentId, req.body.categoryId);
  const due = await FeeDue.create({ ...req.body, schoolId: req.auth.schoolId, classId: student.classId, createdBy: req.auth.userId });
  await due.populate([{ path: 'studentId', select: 'name admissionNumber' }, { path: 'categoryId', select: 'name' }, { path: 'classId', select: 'name section' }]);
  res.status(201).json({ success: true, data: fees.dueDto(due) });
});

exports.bulkDues = asyncHandler(async (req, res) => {
  const { classId, categoryId, dueDate, description } = req.body;
  const { Class } = require('../models');
  const cls = await Class.findOne({ _id: toId(classId, 'classId'), schoolId: req.auth.schoolId });
  if (!cls) throw new AppError(404, 'Class not found', 'NOT_FOUND');
  const category = await FeeCategory.findOne({ _id: toId(categoryId, 'categoryId'), schoolId: req.auth.schoolId, isActive: true });
  if (!category) throw new AppError(400, 'Active fee category not found in your school', 'INVALID_CATEGORY');
  const amountPaise = req.body.amountPaise || category.defaultAmountPaise;
  if (!amountPaise || amountPaise < 1) throw new AppError(400, 'Amount is required (category has no default amount)', 'AMOUNT_REQUIRED');
  const students = await Student.find({ schoolId: req.auth.schoolId, classId: cls._id, isActive: true }).select('_id');
  const existing = await FeeDue.find({ schoolId: req.auth.schoolId, categoryId: category._id, dueDate, studentId: { $in: students.map((s) => s._id) } }).distinct('studentId');
  const have = new Set(existing.map(String));
  const docs = students.filter((s) => !have.has(String(s._id))).map((s) => ({
    schoolId: req.auth.schoolId, studentId: s._id, classId: cls._id, categoryId: category._id, amountPaise, dueDate, description, createdBy: req.auth.userId,
  }));
  if (docs.length) {
    try { await FeeDue.insertMany(docs, { ordered: false }); } catch (e) { if (e.code !== 11000 && !e.writeErrors) throw e; }
  }
  res.status(201).json({ success: true, data: { created: docs.length, skippedExisting: students.length - docs.length } });
});

exports.updateDue = asyncHandler(async (req, res) => {
  const due = await getInSchool(FeeDue, req.auth, req.params.id, 'Fee due');
  const amount = req.body.amountPaise ?? due.amountPaise;
  if (amount < due.paidPaise) throw new AppError(422, 'Amount cannot be lower than what has already been paid', 'AMOUNT_BELOW_PAID');
  // optimistic guard: only update if no payment landed in between
  const updated = await FeeDue.findOneAndUpdate(
    { _id: due._id, schoolId: req.auth.schoolId, paidPaise: due.paidPaise },
    { $set: { amountPaise: amount, dueDate: req.body.dueDate || due.dueDate, status: fees.statusFor(amount, due.paidPaise) } },
    { new: true },
  );
  if (!updated) throw new AppError(409, 'The due changed while editing. Reload and retry.', 'CONFLICT');
  await updated.populate([{ path: 'studentId', select: 'name admissionNumber' }, { path: 'categoryId', select: 'name' }, { path: 'classId', select: 'name section' }]);
  res.json({ success: true, data: fees.dueDto(updated) });
});

exports.createPayment = asyncHandler(async (req, res) => {
  const key = v.idempotencyKey.safeParse(req.get('Idempotency-Key'));
  if (!key.success) throw new AppError(400, 'Idempotency-Key header (8-100 chars) is required', 'IDEMPOTENCY_KEY_REQUIRED');
  const { payment, replayed } = await fees.recordPayment(req.auth, req.body, key.data);
  const receipt = await fees.getReceipt(req.auth, payment.id);
  res.status(replayed ? 200 : 201).json({ success: true, data: receipt, replayed });
});
exports.listPayments = asyncHandler(async (req, res) => {
  const { rows, meta, totals } = await fees.queryPayments(req.auth, req.query);
  res.json({ success: true, data: rows, meta, totals });
});
exports.getPayment = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await fees.getReceipt(req.auth, req.params.id) });
});
