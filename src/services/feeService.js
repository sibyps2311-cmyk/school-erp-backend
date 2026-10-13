const mongoose = require('mongoose');
const { FeeDue, Payment, Counter, Student, Class, User } = require('../models');
const AppError = require('../utils/AppError');
const { toId } = require('../utils/ids');
const { withTx } = require('../utils/tx');
const { todayStr } = require('../utils/dates');
const { escapeRegex } = require('../utils/misc');
const { pageParams, pageMeta } = require('../utils/pagination');

const statusFor = (amountPaise, paidPaise) => (paidPaise <= 0 ? 'unpaid' : paidPaise >= amountPaise ? 'paid' : 'partial');

const clsLabel = (c) => (c ? `${c.name} - ${c.section}` : '');

function dueDto(d) {
  const j = d.toJSON();
  const student = j.studentId && !j.studentId._bsontype ? j.studentId : null;
  const category = j.categoryId && !j.categoryId._bsontype ? j.categoryId : null;
  const cls = j.classId && !j.classId._bsontype ? j.classId : null;
  const outstandingPaise = j.amountPaise - j.paidPaise;
  return {
    id: j.id, studentId: student ? student.id : j.studentId, student, categoryId: category ? category.id : j.categoryId, category,
    classId: cls ? cls.id : j.classId, class: cls, className: clsLabel(cls), description: j.description,
    amountPaise: j.amountPaise, paidPaise: j.paidPaise, outstandingPaise, dueDate: j.dueDate, status: j.status,
    isOverdue: outstandingPaise > 0 && j.dueDate < todayStr(),
  };
}

async function dueFilter(auth, q) {
  const f = { schoolId: auth.schoolId };
  if (q.classId) f.classId = toId(q.classId, 'classId');
  if (q.categoryId) f.categoryId = toId(q.categoryId, 'categoryId');
  if (q.studentId) f.studentId = toId(q.studentId, 'studentId');
  if (q.status === 'outstanding') f.status = { $in: ['unpaid', 'partial'] };
  else if (q.status) f.status = q.status;
  if (q.overdue === 'true') { f.status = { $in: ['unpaid', 'partial'] }; f.dueDate = { $lt: todayStr() }; }
  if (q.search) {
    const r = new RegExp(escapeRegex(q.search), 'i');
    f.studentId = { $in: await Student.find({ schoolId: auth.schoolId, $or: [{ name: r }, { admissionNumber: r }] }).distinct('_id') };
  }
  return f;
}

async function queryDues(auth, q, { paginate = true } = {}) {
  const filter = await dueFilter(auth, q);
  const { page, limit, skip } = pageParams(q);
  let cursor = FeeDue.find(filter).populate('studentId', 'name admissionNumber').populate('categoryId', 'name').populate('classId', 'name section').sort({ dueDate: 1, _id: 1 });
  if (paginate) cursor = cursor.skip(skip).limit(limit);
  const [docs, total, agg] = await Promise.all([
    cursor, FeeDue.countDocuments(filter),
    FeeDue.aggregate([{ $match: filter }, { $group: { _id: null, billed: { $sum: '$amountPaise' }, paid: { $sum: '$paidPaise' } } }]),
  ]);
  const a = agg[0] || { billed: 0, paid: 0 };
  return { rows: docs.map(dueDto), total, totals: { count: total, billedPaise: a.billed, paidPaise: a.paid, outstandingPaise: a.billed - a.paid }, meta: pageMeta(page, limit, total) };
}

async function nextReceiptSeq(schoolId, session) {
  const c = await Counter.findOneAndUpdate({ schoolId, name: 'receipt' }, { $inc: { seq: 1 } }, { new: true, session });
  return c.seq;
}

function paymentDto(p) {
  const j = p.toJSON();
  const pick = (f) => (j[f] && !j[f]._bsontype ? j[f] : null);
  const student = pick('studentId'); const category = pick('categoryId'); const cls = pick('classId'); const by = pick('receivedBy');
  return {
    id: j.id, receiptNumber: j.receiptNumber, amountPaise: j.amountPaise, balanceAfterPaise: j.balanceAfterPaise, method: j.method, reference: j.reference,
    paidAt: j.paidAt, paidDate: j.paidDate, dueId: j.dueId && j.dueId._bsontype ? j.dueId : (j.dueId && j.dueId.id) || j.dueId,
    student, category, class: cls, className: clsLabel(cls), receivedBy: by ? by.name : null,
  };
}
const payPopulate = (q) => q.populate('studentId', 'name admissionNumber').populate('categoryId', 'name').populate('classId', 'name section').populate('receivedBy', 'name');

/**
 * Records a payment safely:
 *  - Idempotency-Key (unique per school): a retry returns the original payment, never charges twice.
 *  - Overpayment guard is part of the atomic update filter (outstanding >= amount), so two concurrent
 *    payments can never push paid above the due amount.
 *  - Due update + receipt number + payment insert happen in one transaction (all-or-nothing).
 */
async function recordPayment(auth, { dueId, amountPaise, method, reference }, idempotencyKey) {
  const schoolId = auth.schoolId;
  const dId = toId(dueId, 'dueId');

  const replay = async () => {
    const existing = await payPopulate(Payment.findOne({ schoolId, idempotencyKey }));
    if (!existing) return null;
    if (String(existing.dueId) !== String(dId) || existing.amountPaise !== amountPaise) {
      throw new AppError(422, 'Idempotency-Key was already used for a different payment', 'IDEMPOTENCY_KEY_REUSED');
    }
    return { payment: paymentDto(existing), replayed: true };
  };

  const prior = await replay();
  if (prior) return prior;

  // make sure the counter row exists OUTSIDE the transaction (avoids upsert races inside it)
  try { await Counter.updateOne({ schoolId, name: 'receipt' }, { $setOnInsert: { seq: 0 } }, { upsert: true }); } catch (e) { if (e.code !== 11000) throw e; }

  let created;
  try {
    created = await withTx(async (session) => {
      const due = await FeeDue.findOneAndUpdate(
        { _id: dId, schoolId, $expr: { $gte: [{ $subtract: ['$amountPaise', '$paidPaise'] }, amountPaise] } },
        { $inc: { paidPaise: amountPaise } },
        { new: true, session },
      );
      if (!due) {
        const d = await FeeDue.findOne({ _id: dId, schoolId }).session(session);
        if (!d) throw new AppError(404, 'Fee due not found', 'NOT_FOUND');
        throw new AppError(422, 'Payment exceeds the outstanding balance', 'OVERPAYMENT', { outstandingPaise: d.amountPaise - d.paidPaise });
      }
      await FeeDue.updateOne({ _id: due._id, schoolId }, { $set: { status: statusFor(due.amountPaise, due.paidPaise) } }, { session });
      const seq = await nextReceiptSeq(schoolId, session);
      const [payment] = await Payment.create([{
        schoolId, dueId: due._id, studentId: due.studentId, classId: due.classId, categoryId: due.categoryId,
        amountPaise, balanceAfterPaise: due.amountPaise - due.paidPaise, method, reference,
        receiptNumber: `${auth.school.code}-${String(seq).padStart(6, '0')}`, idempotencyKey,
        paidAt: new Date(), paidDate: todayStr(), receivedBy: auth.userId,
      }], { session });
      return payment;
    });
  } catch (e) {
    if (e.code === 11000) { const r = await replay(); if (r) return r; }
    throw e;
  }
  const full = await payPopulate(Payment.findById(created._id));
  return { payment: paymentDto(full), replayed: false };
}

async function paymentFilter(auth, q) {
  const f = { schoolId: auth.schoolId };
  ['classId', 'categoryId', 'studentId', 'dueId'].forEach((k) => { if (q[k]) f[k] = toId(q[k], k); });
  if (q.method) f.method = q.method;
  if (q.from || q.to) f.paidDate = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.search) {
    const r = new RegExp(escapeRegex(q.search), 'i');
    const ids = await Student.find({ schoolId: auth.schoolId, $or: [{ name: r }, { admissionNumber: r }] }).distinct('_id');
    f.$or = [{ receiptNumber: r }, { studentId: { $in: ids } }];
  }
  return f;
}

async function queryPayments(auth, q, { paginate = true } = {}) {
  const filter = await paymentFilter(auth, q);
  const { page, limit, skip } = pageParams(q);
  let cursor = payPopulate(Payment.find(filter).sort({ paidAt: -1, _id: -1 }));
  if (paginate) cursor = cursor.skip(skip).limit(limit);
  const [docs, total, agg, byMethod] = await Promise.all([
    cursor, Payment.countDocuments(filter),
    Payment.aggregate([{ $match: filter }, { $group: { _id: null, sum: { $sum: '$amountPaise' } } }]),
    Payment.aggregate([{ $match: filter }, { $group: { _id: '$method', sum: { $sum: '$amountPaise' }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  return {
    rows: docs.map(paymentDto), total,
    totals: { count: total, collectedPaise: agg[0] ? agg[0].sum : 0, byMethod: byMethod.map((m) => ({ method: m._id, count: m.n, amountPaise: m.sum })) },
    meta: pageMeta(page, limit, total),
  };
}

async function getReceipt(auth, id) {
  const p = await payPopulate(Payment.findOne({ _id: toId(id, 'payment id'), schoolId: auth.schoolId }));
  if (!p) throw new AppError(404, 'Payment not found', 'NOT_FOUND');
  const due = await FeeDue.findOne({ _id: p.dueId, schoolId: auth.schoolId });
  const dto = paymentDto(p);
  return {
    ...dto,
    school: { name: auth.school.name, code: auth.school.code, address: auth.school.address || '' },
    due: due ? { amountPaise: due.amountPaise, paidPaise: due.paidPaise, outstandingPaise: due.amountPaise - due.paidPaise, status: due.status, dueDate: due.dueDate, description: due.description } : null,
  };
}

module.exports = { queryDues, dueDto, statusFor, recordPayment, queryPayments, getReceipt, paymentDto };
