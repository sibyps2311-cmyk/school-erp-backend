const h = require('./helpers');

let d; let teacher; let admin;
beforeAll(async () => {
  await h.connect(); d = await h.seedTwoSchools();
  [teacher, admin] = await Promise.all([h.loginAs('teacher@a.test'), h.loginAs('admin@a.test')]);
});
afterAll(h.disconnect);
const id = (x) => String(x._id);

describe('attendance', () => {
  test('teacher can mark and update attendance for an ASSIGNED class (bulk)', async () => {
    const body = { classId: id(d.A.assigned), date: h.today(), records: [{ studentId: id(d.A.s1), status: 'present' }, { studentId: id(d.A.s2), status: 'absent' }] };
    expect((await teacher.put('/api/attendance').send(body)).status).toBe(200);
    const sheet = await teacher.get('/api/attendance').query({ classId: id(d.A.assigned), date: h.today() });
    expect(sheet.body.data.summary).toMatchObject({ total: 2, present: 1, absent: 1, unmarked: 0 });
    body.records[1].status = 'present'; // update saved attendance
    expect((await teacher.put('/api/attendance').send(body)).status).toBe(200);
    const again = await teacher.get('/api/attendance').query({ classId: id(d.A.assigned), date: h.today() });
    expect(again.body.data.summary).toMatchObject({ present: 2, absent: 0 });
  });

  test('teacher is blocked from an UNASSIGNED class (read, write, reports, student history)', async () => {
    const q = { classId: id(d.A.unassigned), date: h.today() };
    expect((await teacher.get('/api/attendance').query(q)).status).toBe(403);
    expect((await teacher.put('/api/attendance').send({ ...q, records: [{ studentId: id(d.A.s3), status: 'present' }] })).status).toBe(403);
    expect((await teacher.get('/api/reports/attendance/daily').query(q)).status).toBe(403);
    expect((await teacher.get(`/api/reports/attendance/student/${id(d.A.s3)}`)).status).toBe(403);
    expect((await teacher.get(`/api/students/${id(d.A.s3)}`)).status).toBe(403);
    expect(await h.M.Attendance.countDocuments({ studentId: d.A.s3._id })).toBe(0);
    // lists silently exclude unassigned classes
    const list = await teacher.get('/api/students?limit=100');
    expect(list.body.data.map((s) => s.admissionNumber).sort()).toEqual(['ADM001', 'ADM002']);
    const cls = await teacher.get('/api/classes');
    expect(cls.body.data.length).toBe(1);
    // admin can still mark the unassigned class
    expect((await admin.put('/api/attendance').send({ ...q, records: [{ studentId: id(d.A.s3), status: 'absent' }] })).status).toBe(200);
  });

  test('duplicate attendance for the same student/date is impossible', async () => {
    const date = '2026-01-12';
    const body = { classId: id(d.A.assigned), date, records: [{ studentId: id(d.A.s1), status: 'present' }] };
    await Promise.all([teacher.put('/api/attendance').send(body), teacher.put('/api/attendance').send(body), admin.put('/api/attendance').send(body)]);
    expect(await h.M.Attendance.countDocuments({ studentId: d.A.s1._id, date })).toBe(1);
    // the DB itself enforces it too
    await expect(h.M.Attendance.create({ schoolId: d.A.school._id, studentId: d.A.s1._id, classId: d.A.assigned._id, date, status: 'absent', markedBy: d.A.admin._id })).rejects.toMatchObject({ code: 11000 });
  });

  test('rejects duplicate students in one request, future dates and bad dates', async () => {
    const rec = { studentId: id(d.A.s1), status: 'present' };
    expect((await teacher.put('/api/attendance').send({ classId: id(d.A.assigned), date: h.today(), records: [rec, rec] })).status).toBe(400);
    expect((await teacher.put('/api/attendance').send({ classId: id(d.A.assigned), date: '2099-01-01', records: [rec] })).status).toBe(400);
    expect((await teacher.put('/api/attendance').send({ classId: id(d.A.assigned), date: '2026-02-30', records: [rec] })).status).toBe(400);
  });

  test('percentages: unmarked dates are excluded from numerator and denominator', async () => {
    const cls = id(d.A.assigned);
    const mark = (date, s1, s2) => teacher.put('/api/attendance').send({ classId: cls, date, records: [{ studentId: id(d.A.s1), status: s1 }, { studentId: id(d.A.s2), status: s2 }] });
    await mark('2025-03-03', 'present', 'present');
    await mark('2025-03-04', 'present', 'absent');
    await mark('2025-03-05', 'absent', 'absent');
    // 2025-03-06..07 intentionally NOT marked
    const range = await teacher.get('/api/reports/attendance/range').query({ classId: cls, from: '2025-03-03', to: '2025-03-07' });
    expect(range.status).toBe(200);
    const s1 = range.body.data.find((r) => r.admissionNumber === 'ADM001');
    const s2 = range.body.data.find((r) => r.admissionNumber === 'ADM002');
    expect(s1).toMatchObject({ present: 2, absent: 1, markedDays: 3, percentage: 66.67 });
    expect(s2).toMatchObject({ present: 1, absent: 2, markedDays: 3, percentage: 33.33 });
    expect(range.body.totals).toMatchObject({ present: 3, absent: 3, percentage: 50, students: 2 });

    const hist = await teacher.get(`/api/reports/attendance/student/${id(d.A.s1)}`).query({ from: '2025-03-01', to: '2025-03-31' });
    expect(hist.body.totals).toMatchObject({ present: 2, absent: 1, markedDays: 3, percentage: 66.67 });
    expect(hist.body.data[0].date).toBe('2025-03-05');

    const daily = await teacher.get('/api/reports/attendance/daily').query({ classId: cls, date: '2025-03-06' });
    expect(daily.body.totals).toMatchObject({ unmarked: 2, percentage: null });
    expect(daily.body.data.every((r) => r.status === 'unmarked')).toBe(true);
  });
});
