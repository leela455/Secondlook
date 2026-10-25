'use strict';
// DEMO / MOCK provider.
//
// This does NOT look at the picture. It derives repeatable numbers from the SHA-256 of the image bytes so the
// workflow can be demonstrated without a model. Every attempt produced here is stored with source.demo = true
// and shown as "Demo result" in the UI. Replace it with a real model (see docs/MODEL_INTEGRATION.md).
const MODEL_VERSION = 'demo-mock-1';

async function assess({ sha256 }) {
  const b = Buffer.from(sha256, 'hex');
  const scale = (i, lo, hi) => lo + Math.round((b[i] / 255) * (hi - lo));
  const detected = b[4] % 3 === 0;
  return {
    quality: {
      sharpness: scale(0, 38, 96),
      lighting: scale(1, 38, 96),
      alignment: scale(2, 38, 96),
      visibility: scale(3, 38, 96),
    },
    defect: {
      detected,
      confidence: scale(5, 55, 97),
      label: detected ? 'surface defect (demo)' : 'no defect (demo)',
      bbox: detected ? { x: 0.3 + (b[6] / 255) * 0.35, y: 0.3 + (b[7] / 255) * 0.3, w: 0.22, h: 0.16 } : undefined,
    },
    modelVersion: MODEL_VERSION,
    metadata: { note: 'Generated from image hash; not a real prediction.' },
  };
}

module.exports = { name: 'demo', kind: 'demo', modelVersion: MODEL_VERSION, assess };
