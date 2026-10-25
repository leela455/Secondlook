// These checks need no database: they prove the server fails safely when MongoDB is unavailable.
const request = require('supertest');
const { createApp } = require('../../app');

const app = createApp();

describe('API without a database connection', () => {
  test('health reports degraded (503) instead of hanging', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, data: { database: 'unavailable' } });
  });

  test('API routes answer 503 DB_UNAVAILABLE without leaking internals', async () => {
    const res = await request(app).get('/api/v1/inspections');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|mongoose|ECONN/i);
  });

  test('unknown routes return a JSON 404', async () => {
    const res = await request(app).get('/definitely-not-here');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  test('security headers are present and x-powered-by is hidden', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
  });

  test('malformed JSON is a clean 400', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect([400, 503]).toContain(res.status); // 503 if the DB guard runs first; never a 500
    expect(res.status).not.toBe(500);
  });

  test('CORS allows configured origins only', async () => {
    const ok = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    const bad = await request(app).get('/api/v1/health').set('Origin', 'http://evil.example');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});
