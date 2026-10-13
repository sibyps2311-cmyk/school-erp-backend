process.env.NODE_ENV = 'test';
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { createApp } = require('../src/app');
const M = require('../src/models');

const PASSWORD = 'Password@123';
const app = createApp();

async function connect() {
  await mongoose.connect(process.env.TEST_MONGO_URI, { dbName: `erp_test_${crypto.randomBytes(5).toString('hex')}` });
  await M.initModels();
}
async function disconnect() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

async function makeUser(schoolId, role, name, email) {
  const user = await M.User.create({ name, email, passwordHash: await bcrypt.hash(PASSWORD, 4) });
  await M.Membership.create({ userId: user._id, schoolId, role });
  return user;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

// Two schools, each with admin/teacher/accountant, an ASSIGNED class (5-A), an UNASSIGNED class (6-A), students, a category and a due.
async function seedTwoSchools() {
  const out = {};
  for (const [key, code, name] of [['A', 'ALP', 'Alpha School'], ['B', 'BET', 'Beta School']]) {
    const school = await M.School.create({ name, code });
    const l = key.toLowerCase();
    const admin = await makeUser(school._id, 'admin', `${key} Admin`, `admin@${l}.test`);
    const teacher = await makeUser(school._id, 'teacher', `${key} Teacher`, `teacher@${l}.test`);
    const accountant = await makeUser(school._id, 'accountant', `${key} Accountant`, `accountant@${l}.test`);
    const assigned = await M.Class.create({ schoolId: school._id, name: 'Grade 5', section: 'A', teacherIds: [teacher._id] });
    const unassigned = await M.Class.create({ schoolId: school._id, name: 'Grade 6', section: 'A', teacherIds: [] });
    const mk = (n, adm, cls) => M.Student.create({ schoolId: school._id, admissionNumber: adm, name: `${key} Student ${n}`, dob: '2015-04-01', gender: 'female', classId: cls._id, guardianName: 'Guardian', phone: '9876543210', admissionDate: '2024-06-01' });
    const s1 = await mk(1, 'ADM001', assigned);
    const s2 = await mk(2, 'ADM002', assigned);
    const s3 = await mk(3, 'ADM003', unassigned);
    const category = await M.FeeCategory.create({ schoolId: school._id, name: 'Tuition', defaultAmountPaise: 1500000 });
    const due = await M.FeeDue.create({ schoolId: school._id, studentId: s1._id, classId: assigned._id, categoryId: category._id, amountPaise: 1500000, dueDate: '2026-12-01' });
    out[key] = { school, admin, teacher, accountant, assigned, unassigned, s1, s2, s3, category, due };
  }
  return out;
}

// Logged-in supertest agent (cookie jar) with the CSRF header preset.
async function loginAs(email) {
  const agent = request.agent(app);
  agent.set('X-Requested-With', 'erp-web');
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

const key = () => `idem-${crypto.randomBytes(8).toString('hex')}`;

module.exports = { app, request, M, PASSWORD, connect, disconnect, seedTwoSchools, loginAs, key, today };
