'use strict';
// Consistent envelope: { success: true, data, meta? }  /  { success: false, error: { code, message, details? } }
const ok = (res, data, { status = 200, meta } = {}) => res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
const pageMeta = (page, limit, total) => ({ page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });

module.exports = { ok, pageMeta };
