'use strict';
const mongoose = require('mongoose');

// Append-only audit trail. There are deliberately no update/delete routes for this collection.
const auditSchema = new mongoose.Schema(
  {
    inspection: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspection', index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null = system / automated rule
    actorName: String,
    action: { type: String, required: true, index: true },
    from: String,
    to: String,
    reason: { type: String, maxlength: 1000 },
    rule: String,
    attemptNumber: Number,
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ inspection: 1, createdAt: 1 });

auditSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('AuditLog', auditSchema);
