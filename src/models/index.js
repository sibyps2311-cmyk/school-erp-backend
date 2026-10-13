require('./plugins');
const mongoose = require('mongoose');
const { Schema } = mongoose;
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });
const paise = (extra = {}) => ({
  type: Number, required: true, validate: { validator: Number.isInteger, message: '{PATH} must be an integer (paise)' }, ...extra,
});
const dateStr = (extra = {}) => ({ type: String, match: /^\d{4}-\d{2}-\d{2}$/, ...extra });

const School = mongoose.model('School', new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true, unique: true },
  address: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true }));

const User = mongoose.model('User', new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  phone: { type: String, trim: true },
  passwordHash: { type: String, required: true, select: false },
  isActive: { type: Boolean, default: true },
}, { timestamps: true }));

// A user's authorised role inside one school. The active school is ALWAYS derived from this.
const membershipSchema = new Schema({
  userId: oid('User', { required: true }),
  schoolId: oid('School', { required: true }),
  role: { type: String, enum: ['admin', 'teacher', 'accountant'], required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
membershipSchema.index({ userId: 1, schoolId: 1 }, { unique: true });
membershipSchema.index({ schoolId: 1, role: 1, isActive: 1 });
const Membership = mongoose.model('Membership', membershipSchema);

const classSchema = new Schema({
  schoolId: oid('School', { required: true }),
  name: { type: String, required: true, trim: true },
  section: { type: String, required: true, trim: true, uppercase: true },
  academicYear: { type: String, trim: true },
  teacherIds: [oid('User')],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
classSchema.index({ schoolId: 1, name: 1, section: 1 }, { unique: true });
classSchema.index({ schoolId: 1, teacherIds: 1 });
const Class = mongoose.model('Class', classSchema);

const studentSchema = new Schema({
  schoolId: oid('School', { required: true }),
  admissionNumber: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  dob: dateStr({ required: true }),
  gender: { type: String, enum: ['male', 'female', 'other'], required: true },
  classId: oid('Class', { required: true }),
  guardianName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  admissionDate: dateStr({ required: true }),
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
studentSchema.index({ schoolId: 1, admissionNumber: 1 }, { unique: true });
studentSchema.index({ schoolId: 1, classId: 1, isActive: 1, name: 1 });
studentSchema.index({ schoolId: 1, name: 1 });
const Student = mongoose.model('Student', studentSchema);

const attendanceSchema = new Schema({
  schoolId: oid('School', { required: true }),
  studentId: oid('Student', { required: true }),
  classId: oid('Class', { required: true }),
  date: dateStr({ required: true }),
  status: { type: String, enum: ['present', 'absent'], required: true },
  markedBy: oid('User', { required: true }),
}, { timestamps: true });
attendanceSchema.index({ schoolId: 1, studentId: 1, date: 1 }, { unique: true }); // one record per student per day
attendanceSchema.index({ schoolId: 1, classId: 1, date: 1 });
attendanceSchema.index({ schoolId: 1, date: 1 });
const Attendance = mongoose.model('Attendance', attendanceSchema);

const feeCategorySchema = new Schema({
  schoolId: oid('School', { required: true }),
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  defaultAmountPaise: paise({ min: 0, default: 0 }),
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
feeCategorySchema.index({ schoolId: 1, name: 1 }, { unique: true });
const FeeCategory = mongoose.model('FeeCategory', feeCategorySchema);

const dueSchema = new Schema({
  schoolId: oid('School', { required: true }),
  studentId: oid('Student', { required: true }),
  classId: oid('Class', { required: true }), // snapshot at assignment time, used for filters/reports
  categoryId: oid('FeeCategory', { required: true }),
  description: { type: String, trim: true },
  amountPaise: paise({ min: 1 }),
  paidPaise: paise({ min: 0, default: 0 }),
  dueDate: dateStr({ required: true }),
  status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  createdBy: oid('User'),
}, { timestamps: true });
dueSchema.index({ schoolId: 1, studentId: 1, categoryId: 1, dueDate: 1 }, { unique: true });
dueSchema.index({ schoolId: 1, status: 1, dueDate: 1 });
dueSchema.index({ schoolId: 1, classId: 1, status: 1 });
const FeeDue = mongoose.model('FeeDue', dueSchema);

const paymentSchema = new Schema({
  schoolId: oid('School', { required: true }),
  dueId: oid('FeeDue', { required: true }),
  studentId: oid('Student', { required: true }),
  classId: oid('Class', { required: true }),
  categoryId: oid('FeeCategory', { required: true }),
  amountPaise: paise({ min: 1 }),
  balanceAfterPaise: paise({ min: 0 }),
  method: { type: String, enum: ['cash', 'upi', 'card', 'bank_transfer', 'cheque'], required: true },
  reference: { type: String, trim: true },
  receiptNumber: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  paidAt: { type: Date, default: Date.now },
  paidDate: dateStr({ required: true }), // school-timezone calendar date, used for date-range reports
  receivedBy: oid('User', { required: true }),
}, { timestamps: true });
paymentSchema.index({ schoolId: 1, receiptNumber: 1 }, { unique: true });
paymentSchema.index({ schoolId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ schoolId: 1, paidDate: 1 });
paymentSchema.index({ schoolId: 1, studentId: 1, paidAt: -1 });
paymentSchema.index({ schoolId: 1, dueId: 1 });
const Payment = mongoose.model('Payment', paymentSchema);

// Per-school sequence generator (receipt numbers).
const counterSchema = new Schema({
  schoolId: oid('School', { required: true }),
  name: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
counterSchema.index({ schoolId: 1, name: 1 }, { unique: true });
const Counter = mongoose.model('Counter', counterSchema);

const allModels = { School, User, Membership, Class, Student, Attendance, FeeCategory, FeeDue, Payment, Counter };

// Creates collections + indexes (needed before using transactions on a fresh database).
async function initModels() {
  await Promise.all(Object.values(allModels).map((m) => m.init()));
}

module.exports = { ...allModels, initModels };
