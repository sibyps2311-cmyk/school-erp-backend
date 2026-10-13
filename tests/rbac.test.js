const h = require('./helpers');

let d; let admin; let teacher; let acct;
beforeAll(async () => {
  await h.connect(); d = await h.seedTwoSchools();
  [admin, teacher, acct] = await Promise.all([h.loginAs('admin@a.test'), h.loginAs('teacher@a.test'), h.loginAs('accountant@a.test')]);
});
afterAll(h.disconnect);

const newStudent = (classId, adm = 'NEW1') => ({ admissionNumber: adm, name: 'New Kid', dob: '2014-01-02', gender: 'male', classId: String(classId), guardianName: 'Parent', phone: '9999999999', admissionDate: '2025-06-01' });

describe('role permissions', () => {
  test('teacher cannot access any fee endpoint', async () => {
    for (const path of ['/api/fees/categories', '/api/fees/dues', '/api/fees/payments', '/api/reports/fees/collection', '/api/reports/fees/outstanding']) {
      expect((await teacher.get(path)).status).toBe(403);
    }
    const pay = await teacher.post('/api/fees/payments').set('Idempotency-Key', h.key()).send({ dueId: String(d.A.due._id), amountPaise: 100, method: 'cash' });
    expect(pay.status).toBe(403);
  });

  test('teacher cannot create/modify students, classes or teachers', async () => {
    expect((await teacher.post('/api/students').send(newStudent(d.A.assigned._id))).status).toBe(403);
    expect((await teacher.put(`/api/students/${d.A.s1._id}`).send({ name: 'Hack' })).status).toBe(403);
    expect((await teacher.delete(`/api/students/${d.A.s1._id}`)).status).toBe(403);
    expect((await teacher.post('/api/classes').send({ name: 'X', section: 'A' })).status).toBe(403);
    expect((await teacher.get('/api/teachers')).status).toBe(403);
  });

  test('accountant cannot mark/read attendance or edit academic records', async () => {
    const body = { classId: String(d.A.assigned._id), date: h.today(), records: [{ studentId: String(d.A.s1._id), status: 'present' }] };
    expect((await acct.put('/api/attendance').send(body)).status).toBe(403);
    expect((await acct.get('/api/attendance').query({ classId: String(d.A.assigned._id), date: h.today() })).status).toBe(403);
    expect((await acct.get('/api/reports/attendance/daily').query({ date: h.today() })).status).toBe(403);
    expect((await acct.post('/api/students').send(newStudent(d.A.assigned._id))).status).toBe(403);
    expect((await acct.put(`/api/students/${d.A.s1._id}`).send({ name: 'Hack' })).status).toBe(403);
    expect((await acct.post('/api/classes').send({ name: 'X', section: 'B' })).status).toBe(403);
  });

  test('accountant sees billing-relevant student data only (no DOB / gender)', async () => {
    const res = await acct.get('/api/students');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.data[0].dob).toBeUndefined();
    expect(res.body.data[0].gender).toBeUndefined();
    expect(res.body.data[0].admissionNumber).toBeDefined();
    const admin1 = await admin.get('/api/students');
    expect(admin1.body.data[0].dob).toBeDefined();
  });

  test('admin and accountant can manage fees; admin can manage students', async () => {
    expect((await acct.get('/api/fees/dues')).status).toBe(200);
    expect((await admin.get('/api/fees/dues')).status).toBe(200);
    const c = await admin.post('/api/students').send(newStudent(d.A.assigned._id));
    expect(c.status).toBe(201);
    expect(c.body.data.admissionNumber).toBe('NEW1');
  });

  test('server-side validation rejects bad input with field details', async () => {
    const res = await admin.post('/api/students').send({ ...newStudent(d.A.assigned._id, 'BAD'), dob: '2099-01-01', phone: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.dob).toBeDefined();
    expect(res.body.error.details.phone).toBeDefined();
    expect((await admin.get('/api/students/not-an-id')).status).toBe(400);
  });

  test('query-string operators are never interpreted (simple query parser + zod)', async () => {
    const plain = await admin.get('/api/students');
    const res = await admin.get('/api/students?classId[$ne]=x&search[$regex]=.*');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(plain.body.meta.total); // the bracket keys are ignored, not applied as operators
    expect((await admin.get('/api/students?classId=%24ne')).status).toBe(400);
  });
});
