'use strict';
// Tiny structured logger. Silent in tests unless LOG_LEVEL is set.
const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const configured = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

function log(level, msg, meta) {
  if (configured === 'silent' || levels[level] > (levels[configured] ?? 2)) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}` + (meta ? ' ' + JSON.stringify(meta) : '');
  (level === 'error' ? console.error : console.log)(line);
}

module.exports = {
  error: (m, x) => log('error', m, x),
  warn: (m, x) => log('warn', m, x),
  info: (m, x) => log('info', m, x),
  debug: (m, x) => log('debug', m, x),
};
