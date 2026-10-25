process.env.FORCE_RATE_LIMIT = '1';
process.env.AUTH_RATE_LIMIT_MAX = '3';
const { startDb, stopDb, makeApi } = require('../helpers/app');

const api = makeApi();
beforeAll(startDb);
afterAll(stopDb);

test('login is rate limited after repeated attempts', async () => {
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await api.post('/auth/login', null, { email: 'a@b.co', password: 'Wrong1234' })).status);
  expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
  expect(statuses.slice(3).every((s) => s === 429)).toBe(true);
});
