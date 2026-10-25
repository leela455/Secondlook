'use strict';

// validate({ body, query, params }) -> parsed values replace req.body / req.valid.query / req.valid.params.
// Express 5 makes req.query read-only, so parsed query values live on req.valid.
const validate = (schemas) => (req, _res, next) => {
  try {
    req.valid = req.valid || {};
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    if (schemas.query) req.valid.query = schemas.query.parse(req.query ?? {});
    if (schemas.params) req.valid.params = schemas.params.parse(req.params ?? {});
    next();
  } catch (e) {
    next(e);
  }
};

module.exports = validate;
