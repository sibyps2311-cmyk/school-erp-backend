const h = require('./helpers');

let d;
beforeAll(async () => { await h.connect(); d = await h.seedTwoSchools(); });
afterAll(h.disconnect);

describe('authentication', () => {
  test('login sets an HTTP-only cookie and never returns the token or password hash', async () => {
    const res = await h.request(h.app).post('/api/auth/login').set('X-Requested-With', 'erp-web').send({ email: 'admin@a.test', password: h.PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/erp_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|eyJ/);
    expect(res.body.data.role).toBe('admin');
    expect(res.body.data.school.code).toBe('ALP');
  });

  test('password is stored hashed', async () => {
    const u = await h.M.User.findOne({ email: 'admin@a.test' }).select('+passwordHash');
    expect(u.passwordHash).not.toBe(h.PASSWORD);
    expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  test('wrong password and unknown email get the same 401', async () => {
    const a = await h.request(h.app).post('/api/auth/login').set('X-Requested-With', 'erp-web').send({ email: 'admin@a.test', password: 'nope-nope' });
    const b = await h.request(h.app).post('/api/auth/login').set('X-Requested-With', 'erp-web').send({ email: 'ghost@a.test', password: 'nope-nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  test('protected routes need a session; me works; logout ends the session', async () => {
    expect((await h.request(h.app).get('/api/students')).status).toBe(401);
    const agent = await h.loginAs('admin@a.test');
    expect((await agent.get('/api/auth/me')).body.data.user.email).toBe('admin@a.test');
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  test('deactivated membership immediately loses access (session re-checked every request)', async () => {
    const agent = await h.loginAs('teacher@b.test');
    expect((await agent.get('/api/students')).status).toBe(200);
    await h.M.Membership.updateOne({ userId: d.B.teacher._id }, { isActive: false });
    expect((await agent.get('/api/students')).status).toBe(401);
    await h.M.Membership.updateOne({ userId: d.B.teacher._id }, { isActive: true });
  });

  test('state-changing requests without the CSRF header are blocked', async () => {
    const res = await h.request(h.app).post('/api/auth/login').send({ email: 'admin@a.test', password: h.PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_BLOCKED');
  });
});
