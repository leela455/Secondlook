'use strict';
const mongoose = require('mongoose');
const { env } = require('./env');
const logger = require('../utils/logger');

mongoose.set('strictQuery', true);

async function connectDB(uri = env.mongoUri, options = {}) {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, ...options });
  // Make sure unique / partial indexes exist before we accept traffic.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  logger.info('MongoDB connected', { db: mongoose.connection.name });
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

const isDbReady = () => mongoose.connection.readyState === 1;

module.exports = { connectDB, disconnectDB, isDbReady };
