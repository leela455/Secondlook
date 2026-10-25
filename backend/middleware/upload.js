'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { env } = require('../config/env');
const AppError = require('../utils/AppError');
const { sniffFile, removeFileQuietly, EXT_BY_MIME } = require('../utils/helpers');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

fs.mkdirSync(env.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  // Random name chosen by the server: the client file name is never used as a path.
  filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
});

const uploader = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes, files: 1, fields: 20, fieldSize: 10 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_EXT.has(ext)) {
      return cb(AppError.badRequest('Unsupported file type. Use a JPG, JPEG, PNG or WEBP image.', { field: 'image' }));
    }
    cb(null, true);
  },
}).single('image');

const safeName = (n) =>
  String(n || 'image')
    .replace(/[\\/]+/g, '_')
    .replace(/[^\x20-\x7E -￿]/g, '')
    .slice(0, 255) || 'image';

// Step 1: parse multipart. Step 2: check the real file signature and give it a safe extension.
const parseImage = (req, res, next) => uploader(req, res, (err) => next(err));

const requireImage = async (req, _res, next) => {
  try {
    if (!req.file) throw AppError.badRequest('An image file is required (field name "image").', { field: 'image' });
    const mime = await sniffFile(req.file.path);
    if (!mime) {
      await removeFileQuietly(req.file.path);
      req.file = undefined;
      throw AppError.badRequest('The file is not a valid JPG, PNG or WEBP image.', { field: 'image' });
    }
    const finalName = `${crypto.randomUUID()}${EXT_BY_MIME[mime]}`;
    const finalPath = path.join(env.uploadDir, finalName);
    await fsp.rename(req.file.path, finalPath);
    req.file.path = finalPath;
    req.file.filename = finalName;
    req.file.detectedMime = mime;
    req.file.safeOriginalName = safeName(req.file.originalname);
    next();
  } catch (e) {
    next(e);
  }
};

module.exports = { uploadImage: [parseImage, requireImage] };
