'use strict';
const AuditLog = require('../models/AuditLog');

/** Append one audit entry. actor = User document or null for automated/system actions. */
async function logAudit({ inspection, actor, action, from, to, reason, rule, attemptNumber, meta }) {
  return AuditLog.create({
    inspection: inspection && inspection._id ? inspection._id : inspection,
    actor: actor ? actor._id : null,
    actorName: actor ? actor.name : 'System (automated rule)',
    action,
    from,
    to,
    reason,
    rule,
    attemptNumber,
    meta,
  });
}

module.exports = { logAudit };
