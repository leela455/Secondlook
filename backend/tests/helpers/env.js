// Runs before every test file: safe defaults so the app can be created without a real .env.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-1234567890';
process.env.BCRYPT_ROUNDS = '4';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads-test';
process.env.INSPECTION_PROVIDER = 'demo';
