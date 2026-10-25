'use strict';
const mongoose = require('mongoose');

// Atomic sequence generator used for human-readable inspection IDs.
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = mongoose.model('Counter', counterSchema);

const CODE_OFFSET = 1000; // seq 1 -> SL-1001, seq 42 -> SL-1042

// A single $inc on one document is atomic, so concurrent requests never get the same ID.
async function nextInspectionCode() {
  const c = await Counter.findOneAndUpdate({ _id: 'inspection' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `SL-${CODE_OFFSET + c.seq}`;
}

const codeToSeq = (code) => Number(String(code).replace('SL-', '')) - CODE_OFFSET;

module.exports = { Counter, nextInspectionCode, codeToSeq, CODE_OFFSET };
