const h = require('./helpers');
const env = require('../src/config/env');
const { cookieOptions } = require('../src/middleware/auth');

let d;
beforeAll(async () => { await h.connect(); d = await h.seedTwoSchools(); });
afterAll(h.disconnect);

describe('authentication', () => {
  test('secure cross-site cookie mode pairs SameSite=None with Secure', () => {
    const previousCookieSecure = env.cookieSecure;
    env.cookieSecure = true;
    try {
      expect(cookieOptions()).toMatchObject({ httpOnly: true, sameSite: 'none', secure: true });
    } finally {
      env.cookieSecure = previousCookieSecure;
    }
  });

  test('trusts one proxy hop and rate-limits forwarded client IPs separately', async () => {
    expect(h.app.get('trust proxy')).toBe(1);

    // Exercise the production limiter in this focused test; the rest of the
    // suite skips it to avoid coupling unrelated auth tests to its memory store.
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      let response;
      for (let i = 0; i < 30; i += 1) {
        response = await h.request(h.app)
          .post('/api/auth/login')
          .set('X-Requested-With', 'erp-web')
          .set('X-Forwarded-For', '198.51.100.21')
          .send({});
        expect(response.status).toBe(400);
      }

      response = await h.request(h.app)
        .post('/api/auth/login')
        .set('X-Requested-With', 'erp-web')
        .set('X-Forwarded-For', '198.51.100.21')
        .send({});
      expect(response.status).toBe(429);

      response = await h.request(h.app)
        .post('/api/auth/login')
        .set('X-Requested-With', 'erp-web')
        .set('X-Forwarded-For', '198.51.100.22')
        .send({});
      expect(response.status).toBe(400);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

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

  test('login cookie authenticates a subsequent dashboard request', async () => {
    const agent = await h.loginAs('admin@a.test');
    const res = await agent.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('admin');
    expect(res.body.data.students).toBe(3);
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
