const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const v = require('../validators');

const auth = require('../controllers/authController');
const classes = require('../controllers/classController');
const teachers = require('../controllers/teacherController');
const students = require('../controllers/studentController');
const attendance = require('../controllers/attendanceController');
const fees = require('../controllers/feeController');
const dashboard = require('../controllers/dashboardController');
const reports = require('../controllers/reportController');

const router = express.Router();
const ADMIN = authorize('admin');
const ACADEMIC = authorize('admin', 'teacher');
const FINANCE = authorize('admin', 'accountant');
const ANY = authorize('admin', 'teacher', 'accountant');

router.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }));

// --- auth
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test', message: { success: false, error: { message: 'Too many login attempts, try again later', code: 'RATE_LIMITED' } } });
router.post('/auth/login', loginLimiter, validate({ body: v.login }), auth.login);
router.post('/auth/logout', auth.logout);
router.get('/auth/me', authenticate, auth.me);

// everything below requires an authenticated session (school resolved from membership)
router.use(authenticate);

router.get('/dashboard', ANY, dashboard.get);

// --- classes & teachers
router.get('/classes', ANY, classes.list);
router.post('/classes', ADMIN, validate({ body: v.classCreate }), classes.create);
router.put('/classes/:id', ADMIN, validate({ params: v.idParam, body: v.classUpdate }), classes.update);
router.put('/classes/:id/teachers', ADMIN, validate({ params: v.idParam, body: v.classTeachers }), classes.setTeachers);

router.get('/teachers', ADMIN, validate({ query: v.teacherList }), teachers.list);
router.post('/teachers', ADMIN, validate({ body: v.teacherCreate }), teachers.create);
router.put('/teachers/:id', ADMIN, validate({ params: v.idParam, body: v.teacherUpdate }), teachers.update);

// --- students
router.get('/students', ANY, validate({ query: v.studentList }), students.list);
router.post('/students', ADMIN, validate({ body: v.studentCreate }), students.create);
router.get('/students/:id', ANY, validate({ params: v.idParam }), students.get);
router.put('/students/:id', ADMIN, validate({ params: v.idParam, body: v.studentUpdate }), students.update);
router.delete('/students/:id', ADMIN, validate({ params: v.idParam }), students.deactivate);

// --- attendance (accountants have no access)
router.get('/attendance', ACADEMIC, validate({ query: v.attendanceGet }), attendance.get);
router.put('/attendance', ACADEMIC, validate({ body: v.attendancePut }), attendance.save);

// --- fees (teachers have no access)
router.get('/fees/categories', FINANCE, fees.listCategories);
router.post('/fees/categories', FINANCE, validate({ body: v.categoryCreate }), fees.createCategory);
router.put('/fees/categories/:id', FINANCE, validate({ params: v.idParam, body: v.categoryUpdate }), fees.updateCategory);
router.get('/fees/dues', FINANCE, validate({ query: v.dueList }), fees.listDues);
router.post('/fees/dues', FINANCE, validate({ body: v.dueCreate }), fees.createDue);
router.post('/fees/dues/bulk', FINANCE, validate({ body: v.dueBulk }), fees.bulkDues);
router.put('/fees/dues/:id', FINANCE, validate({ params: v.idParam, body: v.dueUpdate }), fees.updateDue);
router.get('/fees/payments', FINANCE, validate({ query: v.paymentList }), fees.listPayments);
router.post('/fees/payments', FINANCE, validate({ body: v.paymentCreate }), fees.createPayment);
router.get('/fees/payments/:id', FINANCE, validate({ params: v.idParam }), fees.getPayment);

// --- reports (+ CSV via ?format=csv, same authorization and school scoping as JSON)
router.get('/reports/students', ANY, validate({ query: v.studentList }), reports.students);
router.get('/reports/attendance/daily', ACADEMIC, validate({ query: v.attendanceDaily }), reports.attendanceDaily);
router.get('/reports/attendance/range', ACADEMIC, validate({ query: v.attendanceReport }), reports.attendanceRange);
router.get('/reports/attendance/student/:id', ACADEMIC, validate({ params: v.idParam, query: v.attendanceStudent }), reports.attendanceStudent);
router.get('/reports/fees/collection', FINANCE, validate({ query: v.paymentList }), reports.feeCollection);
router.get('/reports/fees/outstanding', FINANCE, validate({ query: v.dueList }), reports.feeOutstanding);

module.exports = router;
