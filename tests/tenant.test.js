const h = require('./helpers');

let d; let a; let b; let aAcct; let bAcct;
beforeAll(async () => {
  await h.connect(); d = await h.seedTwoSchools();
  [a, b, aAcct, bAcct] = await Promise.all([h.loginAs('admin@a.test'), h.loginAs('admin@b.test'), h.loginAs('accountant@a.test'), h.loginAs('accountant@b.test')]);
});
afterAll(h.disconnect);

const id = (x) => String(x._id);
const stu = (classId, adm) => ({ admissionNumber: adm, name: 'Kid', dob: '2014-01-02', gender: 'male', classId: id(classId), guardianName: 'P', phone: '9999999999', admissionDate: '2025-06-01' });

describe('cross-school READ isolation', () => {
  test('lists only contain the caller\'s school', async () => {
    const res = await a.get('/api/students?limit=100');
    expect(res.body.data.map((s) => s.name).every((n) => n.startsWith('A '))).toBe(true);
    expect(res.body.meta.total).toBe(3);
    const classes = await b.get('/api/classes');
    expect(classes.body.data.every((c) => c.studentCount >= 0)).toBe(true);
    expect(classes.body.data.map((c) => c.id)).not.toContain(id(d.A.assigned));
  });

  test('fetching another school\'s resources by id returns 404', async () => {
    expect((await a.get(`/api/students/${id(d.B.s1)}`)).status).toBe(404);
    expect((await a.get(`/api/reports/attendance/student/${id(d.B.s1)}`)).status).toBe(404);
    expect((await aAcct.get(`/api/fees/payments/${id(d.B.due)}`)).status).toBe(404);
    expect((await a.get('/api/attendance').query({ classId: id(d.B.assigned), date: h.today() })).status).toBe(404);
  });

  test('reports reject another school\'s class filter', async () => {
    expect((await a.get('/api/reports/students').query({ classId: id(d.B.assigned) })).status).toBe(404);
    expect((await a.get('/api/reports/attendance/range').query({ classId: id(d.B.assigned), from: '2026-01-01', to: '2026-12-31' })).status).toBe(404);
  });

  test('a client-supplied schoolId is ignored (record is created in the caller\'s school)', async () => {
    const res = await a.post('/api/students').send({ ...stu(d.A.assigned, 'SPOOF1'), schoolId: id(d.B.school) });
    expect(res.status).toBe(201);
    const row = await h.M.Student.findById(res.body.data.id);
    expect(String(row.schoolId)).toBe(id(d.A.school));
    expect((await b.get('/api/students').query({ search: 'SPOOF1' })).body.data.length).toBe(0);
    // schoolId in the query string has no effect either
    const q = await a.get(`/api/students?schoolId=${id(d.B.school)}&limit=100`);
    expect(q.body.data.every((s) => s.name.startsWith('A '))).toBe(true);
  });
});

describe('cross-school WRITE isolation', () => {
  test('cannot update or deactivate another school\'s student', async () => {
    expect((await a.put(`/api/students/${id(d.B.s1)}`).send({ name: 'Hacked' })).status).toBe(404);
    expect((await a.delete(`/api/students/${id(d.B.s1)}`)).status).toBe(404);
    const row = await h.M.Student.findById(d.B.s1._id);
    expect(row.name).toBe('B Student 1');
    expect(row.isActive).toBe(true);
  });

  test('cannot place a student into another school\'s class (and cannot move one there)', async () => {
    expect((await a.post('/api/students').send(stu(d.B.assigned, 'XCLASS'))).status).toBe(400);
    expect((await a.put(`/api/students/${id(d.A.s1)}`).send({ classId: id(d.B.assigned) })).status).toBe(400);
  });

  test('cannot assign another school\'s teacher to a class; cannot edit another school\'s class/teacher', async () => {
    expect((await a.put(`/api/classes/${id(d.A.assigned)}/teachers`).send({ teacherIds: [id(d.B.teacher)] })).status).toBe(400);
    expect((await a.put(`/api/classes/${id(d.B.assigned)}/teachers`).send({ teacherIds: [id(d.A.teacher)] })).status).toBe(404);
    expect((await a.put(`/api/classes/${id(d.B.assigned)}`).send({ name: 'Hacked' })).status).toBe(404);
    expect((await a.put(`/api/teachers/${id(d.B.teacher)}`).send({ name: 'Hacked' })).status).toBe(404);
  });

  test('cannot mark attendance for another school\'s class or students', async () => {
    const body = { classId: id(d.B.assigned), date: h.today(), records: [{ studentId: id(d.B.s1), status: 'present' }] };
    expect((await a.put('/api/attendance').send(body)).status).toBe(404);
    // own class + foreign student id
    const mixed = { classId: id(d.A.assigned), date: h.today(), records: [{ studentId: id(d.B.s1), status: 'present' }] };
    expect((await a.put('/api/attendance').send(mixed)).status).toBe(400);
    expect(await h.M.Attendance.countDocuments({ studentId: d.B.s1._id })).toBe(0);
  });

  test('cannot create dues or pay dues across schools', async () => {
    expect((await aAcct.post('/api/fees/dues').send({ studentId: id(d.B.s1), categoryId: id(d.A.category), amountPaise: 1000, dueDate: '2026-12-01' })).status).toBe(400);
    expect((await aAcct.post('/api/fees/dues').send({ studentId: id(d.A.s2), categoryId: id(d.B.category), amountPaise: 1000, dueDate: '2026-12-01' })).status).toBe(400);
    const pay = await aAcct.post('/api/fees/payments').set('Idempotency-Key', h.key()).send({ dueId: id(d.B.due), amountPaise: 1000, method: 'cash' });
    expect(pay.status).toBe(404);
    expect((await h.M.FeeDue.findById(d.B.due._id)).paidPaise).toBe(0);
    expect((await aAcct.put(`/api/fees/dues/${id(d.B.due)}`).send({ amountPaise: 5 })).status).toBe(404);
  });
});

describe('cross-school REPORTS and CSV EXPORT isolation', () => {
  test('student CSV contains only the caller\'s school', async () => {
    const res = await a.get('/api/reports/students?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toMatch(/A Student 1/);
    expect(res.text).not.toMatch(/B Student/);
  });

  test('fee CSVs/reports only contain the caller\'s school', async () => {
    await h.M.Payment.deleteMany({});
    const pay = await bAcct.post('/api/fees/payments').set('Idempotency-Key', h.key()).send({ dueId: id(d.B.due), amountPaise: 250000, method: 'cash' });
    expect(pay.status).toBe(201);
    const aCollection = await aAcct.get('/api/reports/fees/collection');
    expect(aCollection.body.totals.collectedPaise).toBe(0);
    const aCsv = await aAcct.get('/api/reports/fees/collection?format=csv');
    expect(aCsv.text).not.toMatch(/B Student|BET-/);
    const bCsv = await bAcct.get('/api/reports/fees/collection?format=csv');
    expect(bCsv.text).toMatch(/BET-000001/);
    const aOut = await aAcct.get('/api/reports/fees/outstanding?format=csv');
    expect(aOut.text).not.toMatch(/B Student/);
    expect(aOut.text).toMatch(/A Student 1/);
  });

  test('dashboards only count the caller\'s school', async () => {
    const dash = await b.get('/api/dashboard');
    expect(dash.body.data.students).toBe(3);
    expect(dash.body.data.fees.collectedPaise).toBe(250000);
    const dashA = await a.get('/api/dashboard');
    expect(dashA.body.data.fees.collectedPaise).toBe(0);
  });
});

describe('school-scoped uniqueness', () => {
  test('same admission number is allowed in different schools but not twice in one school', async () => {
    expect((await a.post('/api/students').send(stu(d.A.assigned, 'UNIQ-1'))).status).toBe(201);
    expect((await b.post('/api/students').send(stu(d.B.assigned, 'UNIQ-1'))).status).toBe(201);
    const dup = await a.post('/api/students').send(stu(d.A.unassigned, 'uniq-1'));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');
  });
});
