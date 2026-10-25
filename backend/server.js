'use strict';
const { env, validateEnv } = require('./config/env');
const logger = require('./utils/logger');

try {
  validateEnv();
} catch (e) {
  console.error('\n' + e.message + '\n');
  console.error('Tip: copy .env.example to .env and fill in the values.');
  process.exit(1);
}

const { connectDB, disconnectDB } = require('./config/db');
const { createApp } = require('./app');
const { describeProvider } = require('./services/inspectionService');

async function main() {
  try {
    await connectDB();
  } catch (e) {
    logger.error(`Could not connect to MongoDB at ${env.mongoUri.replace(/\/\/[^@]*@/, '//***@')}`, { reason: e.message });
    console.error('\nIs MongoDB running? On Windows try:  net start MongoDB   (run Command Prompt as Administrator)');
    console.error('Or set MONGODB_URI in backend/.env to a MongoDB Atlas connection string.\n');
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    const p = describeProvider();
    logger.info(`SecondLook API listening on http://localhost:${env.port}  (env: ${env.nodeEnv})`);
    logger.info(`Inspection provider: ${p.provider}${p.demo ? '  [DEMO MODE: mock scores, not real AI predictions]' : ''}`);
    if (env.serveFrontend) logger.info(`Frontend served at http://localhost:${env.port}/`);
  });

  const shutdown = async (sig) => {
    logger.info(`${sig} received, shutting down`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (r) => logger.error('Unhandled promise rejection', { reason: String(r && r.stack ? r.stack : r) }));
}

main();
