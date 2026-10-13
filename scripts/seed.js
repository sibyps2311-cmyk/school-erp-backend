/* Seeds two schools with synthetic data. WARNING: wipes the target database collections first. */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const env = require('../src/config/env');
const { connectDb } = require('../src/config/db');
const M = require('../src/models');
const { recordPayment } = require('../src/services/feeService');
const { todayStr, addDays } = require('../src/utils/dates');

const PASSWORD = 'Password@123';
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Ishaan', 'Kabir', 'Rohan', 'Dev', 'Ananya', 'Diya', 'Meera', 'Isha', 'Kavya', 'Riya', 'Saanvi', 'Tara', 'Nikhil', 'Neha', 'Pooja', 'Rahul', 'Sneha', 'Varun', 'Zoya', 'Yash'];
const LAST = ['Nair', 'Menon', 'Pillai', 'Varma', 'Kurian', 'Joseph', 'Thomas', 'Krishnan', 'Iyer', 'Das'];

const SCHOOLS = [
  { code: 'GPS', name: 'Greenfield Public School', slug: 'greenfield', address: '12 Lake Road, Thrissur' },
  { code: 'RVA', name: 'Riverside Academy', slug: 'riverside', address: '45 Canal Street, Kochi' },
];

function weekdaysBack(n) {
  const out = []; let d = todayStr();
  while (out.length < n) { const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); if (dow !== 0 && dow !== 6) out.push(d); d = addDays(d, -1); }
  return out.reverse();
}

async function main() {
  await connectDb();
  await M.initModels();
  await Promise.all(Object.values(M).filter((m) => m.deleteMany).map((m) => m.deleteMany({})));
  const hash = await bcrypt.hash(PASSWORD, 10);
  const days = weekdaysBack(10);
  const creds = [];

  for (const [si, def] of SCHOOLS.entries()) {
    const school = await M.School.create({ name: def.name, code: def.code, address: def.address });
    const mkUser = async (role, name, email) => {
      const u = await M.User.create({ name, email, passwordHash: hash });
      await M.Membership.create({ userId: u._id, schoolId: school._id, role });
      creds.push({ school: def.name, role, email });
      return u;
    };
    const admin = await mkUser('admin', `${def.slug} Admin`.replace(/^./, (c) => c.toUpperCase()), `admin@${def.slug}.example`);
    const t1 = await mkUser('teacher', 'Anitha Menon', `teacher1@${def.slug}.example`);
    const t2 = await mkUser('teacher', 'Suresh Kumar', `teacher2@${def.slug}.example`);
    const accountant = await mkUser('accountant', 'Latha Nair', `accountant@${def.slug}.example`);

    // 5-A (teacher1), 5-B (teacher2), 6-A is deliberately UNASSIGNED
    const c5a = await M.Class.create({ schoolId: school._id, name: 'Grade 5', section: 'A', academicYear: '2026-27', teacherIds: [t1._id] });
    const c5b = await M.Class.create({ schoolId: school._id, name: 'Grade 5', section: 'B', academicYear: '2026-27', teacherIds: [t2._id] });
    const c6a = await M.Class.create({ schoolId: school._id, name: 'Grade 6', section: 'A', academicYear: '2026-27', teacherIds: [] });

    const students = [];
    let n = 0;
    for (const [ci, cls] of [c5a, c5b, c6a].entries()) {
      for (let i = 0; i < 8; i += 1) {
        n += 1;
        const name = `${FIRST[(n * 3 + si) % FIRST.length]} ${LAST[(n + ci) % LAST.length]}`;
        students.push(await M.Student.create({
          schoolId: school._id, admissionNumber: `${def.code}-${String(2400 + n)}`, name,
          dob: `${2014 - ci}-0${(i % 9) + 1}-1${i % 9}`, gender: n % 2 ? 'male' : 'female', classId: cls._id,
          guardianName: `${LAST[(n + 2) % LAST.length]} Guardian`, phone: `98${String(46000000 + n * 137).slice(0, 8)}`, admissionDate: '2024-06-03',
          isActive: !(si === 0 && n === 24), // one inactive student in the first school
        }));
      }
    }

    // attendance: all classes for 10 weekdays, except the unassigned class only has the last 3 days (demonstrates "unmarked")
    for (const s of students.filter((x) => x.isActive)) {
      const cls = [c5a, c5b, c6a].find((c) => c._id.equals(s.classId));
      const markers = { [c5a._id]: t1, [c5b._id]: t2, [c6a._id]: admin };
      const usable = c6a._id.equals(cls._id) ? days.slice(-3) : days;
      await M.Attendance.insertMany(usable.map((date) => ({
        schoolId: school._id, studentId: s._id, classId: cls._id, date, status: rnd() < 0.12 ? 'absent' : 'present', markedBy: markers[cls._id]._id,
      })));
    }

    const tuition = await M.FeeCategory.create({ schoolId: school._id, name: 'Tuition Fee', description: 'Term tuition', defaultAmountPaise: 1500000 });
    const transport = await M.FeeCategory.create({ schoolId: school._id, name: 'Transport Fee', defaultAmountPaise: 600000 });
    await M.FeeCategory.create({ schoolId: school._id, name: 'Library Fee', defaultAmountPaise: 100000 });

    const auth = { schoolId: school._id, userId: accountant._id, school };
    const active = students.filter((x) => x.isActive);
    for (const [i, s] of active.entries()) {
      const mk = (cat, amountPaise, dueDate) => M.FeeDue.create({ schoolId: school._id, studentId: s._id, classId: s.classId, categoryId: cat._id, amountPaise, dueDate, createdBy: admin._id });
      const tDue = await mk(tuition, 1500000, i % 3 === 0 ? addDays(todayStr(), -20) : addDays(todayStr(), 25)); // some overdue
      const bus = i % 2 === 0 ? await mk(transport, 600000, addDays(todayStr(), 10)) : null;
      const plan = i % 4; // 0: unpaid, 1: partial (6000 + 4000), 2: paid in full, 3: one partial
      const pay = (due, amt, tag) => recordPayment(auth, { dueId: String(due._id), amountPaise: amt, method: ['cash', 'upi', 'card'][(i + tag) % 3], reference: `SEED-${i}-${tag}` }, `seed-${school.code}-${i}-${tag}`);
      if (plan === 1) { await pay(tDue, 600000, 1); await pay(tDue, 400000, 2); }
      if (plan === 2) { await pay(tDue, 1500000, 1); if (bus) await pay(bus, 600000, 2); }
      if (plan === 3) await pay(tDue, 500000, 1);
    }
  }

  console.log('\nSeed complete. All demo accounts use password:', PASSWORD);
  console.table(creds);
  await mongoose.disconnect();
}

main().catch(async (e) => { console.error('Seed failed:', e.message); await mongoose.disconnect(); process.exit(1); });
