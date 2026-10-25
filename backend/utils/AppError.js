'use strict';
// Error that is safe to show to API clients (everything else becomes a generic 500).
class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
    this.details = details;
    this.expose = true;
  }
}

AppError.badRequest = (m, details) => new AppError(400, m, 'BAD_REQUEST', details);
AppError.unauthorized = (m = 'Authentication required') => new AppError(401, m, 'UNAUTHORIZED');
AppError.forbidden = (m = 'You do not have permission to do that') => new AppError(403, m, 'FORBIDDEN');
AppError.notFound = (m = 'Not found') => new AppError(404, m, 'NOT_FOUND');
AppError.conflict = (m) => new AppError(409, m, 'CONFLICT');

module.exports = AppError;
