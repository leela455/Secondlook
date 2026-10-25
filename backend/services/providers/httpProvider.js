'use strict';
// Generic HTTP provider: sends the image to a configured service and validates its declared response
// in inspectionService.js. An HTTP service may be quality-only and does not imply defect inference.
//
// Request:  POST MODEL_API_URL   multipart/form-data   field "image" (+ context metadata and optional modelCategory)
//           Authorization: Bearer MODEL_API_KEY        (only if MODEL_API_KEY is set)
// Response: { "modelVersion": "...", "quality": {sharpness,lighting,alignment,visibility}, "defect": {...} }
const fsp = require('fs/promises');
const { env } = require('../../config/env');

async function assess({ filePath, mimeType, originalName, context = {} }) {
  const bytes = await fsp.readFile(filePath);
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mimeType }), originalName || 'image');
  if (context.inspectionType) form.append('inspectionType', context.inspectionType);
  if (context.componentName) form.append('componentName', context.componentName);
  if (context.modelCategory) form.append('model_category', context.modelCategory);

  const res = await fetch(env.modelApiUrl, {
    method: 'POST',
    body: form,
    headers: env.modelApiKey ? { Authorization: `Bearer ${env.modelApiKey}` } : {},
    signal: AbortSignal.timeout(env.modelApiTimeoutMs),
  });
  if (!res.ok) throw new Error(`Model service responded with HTTP ${res.status}`);
  return res.json();
}

async function listCategories() {
  const endpoint = new URL(env.modelApiUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/(predict|assess)\/?$/, '').replace(/\/$/, '')}/categories`;
  const res = await fetch(endpoint, {
    headers: env.modelApiKey ? { Authorization: `Bearer ${env.modelApiKey}` } : {},
    signal: AbortSignal.timeout(env.modelApiTimeoutMs),
  });
  if (!res.ok) throw new Error(`Model service responded with HTTP ${res.status}`);
  const body = await res.json();
  if (!body || !Array.isArray(body.categories)) throw new Error('Model category response is invalid.');
  return body;
}

module.exports = { name: 'http', kind: 'model', assess, listCategories };
