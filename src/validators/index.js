const { z } = require('zod');
const { isRealDate, todayStr } = require('../utils/dates');

const id = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const dateStr = z.string().refine(isRealDate, 'Use a valid date (YYYY-MM-DD)');
const pastDate = dateStr.refine((d) => d <= todayStr(), 'Date cannot be in the future');
const str = (min = 1, max = 120) => z.string().trim().min(min, 'Required').max(max);
const phone = z.string().trim().regex(/^[0-9+\-\s]{7,15}$/, 'Enter a valid phone number');
const paise = z.number({ invalid_type_error: 'Amount must be a number' }).int('Amount must be whole paise').positive('Amount must be greater than 0').max(100000000000);
const boolStr = z.enum(['true', 'false']);
const page = { page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() };
const format = { format: z.enum(['json', 'csv']).optional() };
const range = { from: dateStr.optional(), to: dateStr.optional() };
const optId = id.optional();

const v = {
  idParam: z.object({ id }),
  login: z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200), schoolCode: z.string().trim().max(20).optional() }),

  classCreate: z.object({ name: str(1, 50), section: str(1, 10), academicYear: z.string().trim().max(20).optional() }),
  classUpdate: z.object({ name: str(1, 50).optional(), section: str(1, 10).optional(), academicYear: z.string().trim().max(20).optional(), isActive: z.boolean().optional() }),
  classTeachers: z.object({ teacherIds: z.array(id).max(20) }),

  teacherCreate: z.object({ name: str(2, 80), email: z.string().trim().toLowerCase().email(), phone: phone.optional(), password: z.string().min(8, 'At least 8 characters').max(100) }),
  teacherUpdate: z.object({ name: str(2, 80).optional(), phone: phone.optional(), isActive: z.boolean().optional(), password: z.string().min(8).max(100).optional() }),
  teacherList: z.object({ ...page, search: z.string().trim().max(60).optional(), isActive: z.enum(['true', 'false', 'all']).optional() }),

  studentBase: {
    admissionNumber: str(1, 30), name: str(2, 80), dob: pastDate, gender: z.enum(['male', 'female', 'other']),
    classId: id, guardianName: str(2, 80), phone, admissionDate: dateStr,
  },
  studentList: z.object({ ...page, ...format, search: z.string().trim().max(60).optional(), classId: optId, gender: z.enum(['male', 'female', 'other']).optional(), isActive: z.enum(['true', 'false', 'all']).optional() }),

  attendanceGet: z.object({ classId: id, date: dateStr }),
  attendancePut: z.object({
    classId: id, date: pastDate,
    records: z.array(z.object({ studentId: id, status: z.enum(['present', 'absent']) })).min(1).max(500),
  }),
  attendanceReport: z.object({ ...page, ...format, ...range, classId: optId, search: z.string().trim().max(60).optional() }),
  attendanceDaily: z.object({ ...page, ...format, date: dateStr, classId: optId, search: z.string().trim().max(60).optional() }),
  attendanceStudent: z.object({ ...page, ...format, ...range }),

  categoryCreate: z.object({ name: str(2, 60), description: z.string().trim().max(200).optional(), defaultAmountPaise: z.number().int().min(0).max(100000000000).optional() }),
  categoryUpdate: z.object({ name: str(2, 60).optional(), description: z.string().trim().max(200).optional(), defaultAmountPaise: z.number().int().min(0).max(100000000000).optional(), isActive: z.boolean().optional() }),
  dueCreate: z.object({ studentId: id, categoryId: id, amountPaise: paise, dueDate: dateStr, description: z.string().trim().max(200).optional() }),
  dueBulk: z.object({ classId: id, categoryId: id, amountPaise: paise.optional(), dueDate: dateStr, description: z.string().trim().max(200).optional() }),
  dueUpdate: z.object({ amountPaise: paise.optional(), dueDate: dateStr.optional() }),
  dueList: z.object({ ...page, ...format, search: z.string().trim().max(60).optional(), classId: optId, categoryId: optId, studentId: optId, status: z.enum(['unpaid', 'partial', 'paid', 'outstanding']).optional(), overdue: boolStr.optional() }),
  paymentCreate: z.object({ dueId: id, amountPaise: paise, method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'cheque']), reference: z.string().trim().max(80).optional() }),
  paymentList: z.object({ ...page, ...format, ...range, search: z.string().trim().max(60).optional(), classId: optId, categoryId: optId, studentId: optId, dueId: optId, method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'cheque']).optional() }),
};
v.studentCreate = z.object(v.studentBase);
v.studentUpdate = z.object({ ...v.studentBase, isActive: z.boolean().optional() }).partial();
v.idempotencyKey = z.string().trim().min(8).max(100);

module.exports = v;
