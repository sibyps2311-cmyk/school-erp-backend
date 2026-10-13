const h = require('./helpers');

let d; let acct; let admin;
beforeAll(async () => {
  await h.connect(); d = await h.seedTwoSchools();
  [acct, admin] = await Promise.all([h.loginAs('accountant@a.test'), h.loginAs('admin@a.test')]);
});
afterAll(h.disconnect);

const id = (x) => String(x._id);
const pay = (agent, dueId, amountPaise, key = h.key(), extra = {}) =>
  agent.post('/api/fees/payments').set('Idempotency-Key', key).send({ dueId, amountPaise, method: 'cash', ...extra });
const reload = () => h.M.FeeDue.findById(d.A.due._id);
// INR 15,000 due => 1,500,000 paise.  INR 6,000 = 600,000.  INR 4,000 = 400,000.

describe('partial payments and balances', () => {
  test('15,000 - 6,000 - 4,000 leaves 5,000 with correct statuses and receipts', async () => {
    let due = await reload();
    expect(due.status).toBe('unpaid');

    const p1 = await pay(acct, id(d.A.due), 600000);
    expect(p1.status).toBe(201);
    expect(p1.body.data.balanceAfterPaise).toBe(900000);
    expect(p1.body.data.due).toMatchObject({ outstandingPaise: 900000, status: 'partial' });

    const p2 = await pay(admin, id(d.A.due), 400000);
    expect(p2.status).toBe(201);
    expect(p2.body.data.balanceAfterPaise).toBe(500000);

    due = await reload();
    expect(due.paidPaise).toBe(1000000);
    expect(due.status).toBe('partial');
    expect(p1.body.data.receiptNumber).not.toBe(p2.body.data.receiptNumber);

    const list = await acct.get('/api/fees/dues').query({ studentId: id(d.A.s1) });
    expect(list.body.data[0]).toMatchObject({ amountPaise: 1500000, paidPaise: 1000000, outstandingPaise: 500000, status: 'partial' });

    const history = await acct.get('/api/fees/payments').query({ studentId: id(d.A.s1) });
    expect(history.body.meta.total).toBe(2);
    expect(history.body.totals.collectedPaise).toBe(1000000);

    const p3 = await pay(acct, id(d.A.due), 500000);
    expect(p3.status).toBe(201);
    due = await reload();
    expect(due.status).toBe('paid');
    expect(due.paidPaise).toBe(due.amountPaise);
  });

  test('money must be a positive integer number of paise', async () => {
    expect((await pay(acct, id(d.A.due), 0)).status).toBe(400);
    expect((await pay(acct, id(d.A.due), -5)).status).toBe(400);
    expect((await pay(acct, id(d.A.due), 10.5)).status).toBe(400);
    expect((await acct.post('/api/fees/payments').send({ dueId: id(d.A.due), amountPaise: 100, method: 'cash' })).status).toBe(400); // missing Idempotency-Key
  });
});

describe('overpayment and retries', () => {
  let due2;
  beforeAll(async () => {
    due2 = await h.M.FeeDue.create({ schoolId: d.A.school._id, studentId: d.A.s2._id, classId: d.A.assigned._id, categoryId: d.A.category._id, amountPaise: 1000000, dueDate: '2026-12-01' });
  });

  test('payment greater than the outstanding balance is rejected and changes nothing', async () => {
    const before = await h.M.Payment.countDocuments({ dueId: due2._id });
    const res = await pay(acct, id(due2), 1000001);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OVERPAYMENT');
    expect(res.body.error.details.outstandingPaise).toBe(1000000);
    expect((await h.M.FeeDue.findById(due2._id)).paidPaise).toBe(0);
    expect(await h.M.Payment.countDocuments({ dueId: due2._id })).toBe(before);
  });

  test('a retry with the same Idempotency-Key does not charge twice and returns the same receipt', async () => {
    const key = h.key();
    const first = await pay(acct, id(due2), 300000, key);
    const retry = await pay(acct, id(due2), 300000, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.data.receiptNumber).toBe(first.body.data.receiptNumber);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect((await h.M.FeeDue.findById(due2._id)).paidPaise).toBe(300000);
    expect(await h.M.Payment.countDocuments({ dueId: due2._id })).toBe(1);
  });

  test('reusing a key for a different payment is refused', async () => {
    const key = h.key();
    await pay(acct, id(due2), 100000, key);
    const bad = await pay(acct, id(due2), 200000, key);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await h.M.FeeDue.findById(due2._id)).paidPaise).toBe(400000);
  });

  test('simultaneous duplicate submissions (same key) create exactly one payment', async () => {
    const due = await h.M.FeeDue.create({ schoolId: d.A.school._id, studentId: d.A.s3._id, classId: d.A.unassigned._id, categoryId: d.A.category._id, amountPaise: 1000000, dueDate: '2026-12-02' });
    const key = h.key();
    const results = await Promise.all([1, 2, 3, 4].map(() => pay(acct, id(due), 250000, key)));
    results.forEach((r) => expect([200, 201]).toContain(r.status));
    expect(new Set(results.map((r) => r.body.data.receiptNumber)).size).toBe(1);
    expect(await h.M.Payment.countDocuments({ dueId: due._id })).toBe(1);
    expect((await h.M.FeeDue.findById(due._id)).paidPaise).toBe(250000);
  });

  test('concurrent different payments can never exceed the due (10,000 due, 6 x 3,000 attempts => exactly 3 succeed)', async () => {
    const due = await h.M.FeeDue.create({ schoolId: d.A.school._id, studentId: d.A.s3._id, classId: d.A.unassigned._id, categoryId: d.A.category._id, amountPaise: 1000000, dueDate: '2026-12-03' });
    const results = await Promise.all(Array.from({ length: 6 }, () => pay(acct, id(due), 300000)));
    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);
    expect(ok.length).toBe(3);
    expect(rejected.length).toBe(3);
    rejected.forEach((r) => expect(r.body.error.code).toBe('OVERPAYMENT'));
    const after = await h.M.FeeDue.findById(due._id);
    expect(after.paidPaise).toBe(900000);
    expect(after.paidPaise).toBeLessThanOrEqual(after.amountPaise);
    const payments = await h.M.Payment.find({ dueId: due._id });
    expect(payments.reduce((s, p) => s + p.amountPaise, 0)).toBe(after.paidPaise); // payments and balance stay consistent
    expect(payments.length).toBe(3);
  });
});

describe('receipts', () => {
  test('receipt numbers are unique per school and sequential, even when issued concurrently', async () => {
    const due = await h.M.FeeDue.create({ schoolId: d.A.school._id, studentId: d.A.s2._id, classId: d.A.assigned._id, categoryId: d.A.category._id, amountPaise: 5000000, dueDate: '2026-12-04' });
    const results = await Promise.all(Array.from({ length: 8 }, () => pay(acct, id(due), 100000)));
    results.forEach((r) => expect(r.status).toBe(201));
    const numbers = results.map((r) => r.body.data.receiptNumber);
    expect(new Set(numbers).size).toBe(8);
    numbers.forEach((n) => expect(n).toMatch(/^ALP-\d{6}$/));
    const all = await h.M.Payment.find({ schoolId: d.A.school._id });
    expect(new Set(all.map((p) => p.receiptNumber)).size).toBe(all.length);
  });

  test('receipt detail carries school, student, due and balance; DB rejects a duplicate receipt number', async () => {
    const p = await h.M.Payment.findOne({ schoolId: d.A.school._id });
    const res = await acct.get(`/api/fees/payments/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.school.name).toBe('Alpha School');
    expect(res.body.data.student.admissionNumber).toBeDefined();
    expect(res.body.data.due.outstandingPaise).toBeDefined();
    const clone = p.toObject();
    delete clone._id;
    await expect(h.M.Payment.create({ ...clone, idempotencyKey: h.key() })).rejects.toMatchObject({ code: 11000 });
  });

  test('another school has its own receipt sequence (same number allowed across schools)', async () => {
    const bAcct = await h.loginAs('accountant@b.test');
    const res = await pay(bAcct, id(d.B.due), 100000);
    expect(res.status).toBe(201);
    expect(res.body.data.receiptNumber).toBe('BET-000001');
  });
});
