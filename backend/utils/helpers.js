'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const mongoose = require('mongoose');
const AppError = require('./AppError');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function assertObjectId(id, label = 'id') {
  if (!mongoose.isValidObjectId(id) || String(id).length !== 24) throw AppError.badRequest(`Invalid ${label}`);
  return id;
}

// Image signatures; we never trust the client-supplied MIME type or file name.
function detectImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

async function sniffFile(filePath) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    return detectImageType(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')));
  });
}

const removeFileQuietly = async (p) => {
  if (!p) return;
  try {
    await fsp.unlink(p);
  } catch (_) {
    /* already gone */
  }
};

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

module.exports = { asyncHandler, escapeRegex, assertObjectId, detectImageType, sniffFile, sha256File, removeFileQuietly, EXT_BY_MIME };
