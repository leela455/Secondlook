const User = require('../../models/User');
const { startDb, stopDb, clearDb, makeApi, createUsers } = require('../helpers/app');

const api = makeApi();
beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const good = { name: 'Test User', email: 'test@example.com', password: 'Passw0rd!x' };

describe('registration', () => {
  test('first account becomes admin, later accounts are inspectors, role cannot be chosen', async () => {
    const a = await api.post('/auth/register', null, good);
    expect(a.status).toBe(201);
    expect(a.body.data.user.role).toBe('admin');
    expect(a.body.data.token).toEqual(expect.any(String));

    const b = await api.post('/auth/register', null, { ...good, email: 'b@example.com', role: 'admin' });
    expect(b.status).toBe(201);
    expect(b.body.data.user.role).toBe('inspector');
  });

  test('response never contains the password hash or token version', async () => {
    const r = await api.post('/auth/register', null, good);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/password|tokenVersion|\$2[aby]\$/i);
  });

  test('password is stored hashed with bcrypt', async () => {
    await api.post('/auth/register', null, good);
    const u = await User.findOne({ email: good.email }).select('+password');
    expect(u.password).not.toBe(good.password);
    expect(u.password).toMatch(/^\$2[aby]\$/);
  });

  test('duplicate email -> 409 (case-insensitive)', async () => {
    await api.post('/auth/register', null, good);
    const r = await api.post('/auth/register', null, { ...good, email: 'TEST@Example.com' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EMAIL_TAKEN');
  });

  test.each([
    ['short password', { ...good, password: 'a1' }],
    ['no digit', { ...good, password: 'abcdefghij' }],
    ['bad email', { ...good, email: 'nope' }],
    ['short name', { ...good, name: 'A' }],
    ['missing fields', {}],
  ])('invalid input (%s) -> 400 with field details', async (_n, body) => {
    const r = await api.post('/auth/register', null, body);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.length).toBeGreaterThan(0);
  });

  test('NoSQL operator objects in the body are rejected, not executed', async () => {
    await api.post('/auth/register', null, good);
    const r = await api.post('/auth/login', null, { email: { $ne: null }, password: { $ne: null } });
    expect(r.status).toBe(400);
  });
});

describe('login / session', () => {
  beforeEach(async () => {
    await api.post('/auth/register', null, good);
  });

  test('valid credentials return a token; /auth/me works with it', async () => {
    const r = await api.post('/auth/login', null, { email: good.email, password: good.password });
    expect(r.status).toBe(200);
    const me = await api.get('/auth/me', r.body.data.token);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(good.email);
  });

  test('wrong password and unknown email give the same generic 401', async () => {
    const a = await api.post('/auth/login', null, { email: good.email, password: 'WrongPass1' });
    const b = await api.post('/auth/login', null, { email: 'ghost@example.com', password: 'WrongPass1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  test('protected endpoints reject missing, malformed and forged tokens', async () => {
    for (const path of ['/inspections', '/analytics/dashboard', '/settings', '/reviews', '/auth/me']) {
      expect((await api.get(path)).status).toBe(401);
    }
    expect((await api.get('/inspections', 'not.a.jwt')).status).toBe(401);
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ sub: '507f1f77bcf86cd799439011', tv: 0 }, 'a-different-secret-that-is-long-enough-123');
    expect((await api.get('/inspections', forged)).status).toBe(401);
  });

  test('an expired token is rejected with SESSION_EXPIRED', async () => {
    const jwt = require('jsonwebtoken');
    const { env } = require('../../config/env');
    const u = await User.findOne({ email: good.email });
    const expired = jwt.sign({ sub: String(u._id), tv: 0 }, env.jwtSecret, { expiresIn: -10 });
    const r = await api.get('/auth/me', expired);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('SESSION_EXPIRED');
  });

  test('logout invalidates the token server-side', async () => {
    const { token } = (await api.post('/auth/login', null, { email: good.email, password: good.password })).body.data;
    expect((await api.post('/auth/logout', token)).status).toBe(200);
    expect((await api.get('/auth/me', token)).status).toBe(401);
    const again = await api.post('/auth/login', null, { email: good.email, password: good.password });
    expect((await api.get('/auth/me', again.body.data.token)).status).toBe(200);
  });
});

describe('user administration & role checks', () => {
  test('only admins can list or change users; admin cannot change themselves', async () => {
    const u = await createUsers(api);
    expect((await api.get('/users', u.inspector.token)).status).toBe(403);
    expect((await api.get('/users', u.reviewer.token)).status).toBe(403);
    const list = await api.get('/users', u.admin.token);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(4);

    expect((await api.patch(`/users/${u.inspector.id}`, u.inspector.token, { role: 'admin' })).status).toBe(403);
    expect((await api.patch(`/users/${u.admin.id}`, u.admin.token, { role: 'inspector' })).status).toBe(400);
    const promoted = await api.patch(`/users/${u.inspector2.id}`, u.admin.token, { role: 'reviewer' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.role).toBe('reviewer');
  });

  test('disabling a user locks them out immediately and blocks login', async () => {
    const u = await createUsers(api);
    expect((await api.patch(`/users/${u.inspector.id}`, u.admin.token, { active: false })).status).toBe(200);
    expect((await api.get('/inspections', u.inspector.token)).status).toBe(401);
    const login = await api.post('/auth/login', null, { email: 'ivy@test.io', password: u.pw });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  test('invalid user id -> 400', async () => {
    const u = await createUsers(api);
    expect((await api.patch('/users/not-an-id', u.admin.token, { role: 'reviewer' })).status).toBe(400);
  });
});
