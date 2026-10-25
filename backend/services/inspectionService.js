'use strict';
// The replaceable "AI inspection" boundary.
//
// A provider is: { name, kind: 'demo' | 'model', assess({filePath, mimeType, sha256, originalName, context}) }
// and must resolve to the shape validated by `assessmentSchema` below. Everything the provider returns is
// validated; anything malformed, slow or failing becomes assessmentStatus "failed", which the decision rules
// route to a human reviewer (never to "Passed").
const { z } = require('zod');
const { env } = require('../config/env');
const { VISA_MODEL_CATEGORIES } = require('../utils/constants');
const demoProvider = require('./providers/demoProvider');
const httpProvider = require('./providers/httpProvider');

const score = z.number().finite().min(0).max(100);
const fraction = z.number().finite().min(0).max(1);

const commonAssessmentSchema = z.object({
  modelVersion: z.string().min(1).max(100),
  modelCategory: z.enum(VISA_MODEL_CATEGORIES).nullable().optional(),
  quality: z.object({ sharpness: score.nullable(), lighting: score.nullable(), alignment: score.nullable(), visibility: score.nullable() }),
  metadata: z.record(z.string(), z.any()).optional(),
});
const predictionSchema = commonAssessmentSchema.extend({
  defect: z.object({
    detected: z.boolean(),
    confidence: score, // 0-100 confidence in the prediction above
    label: z.string().max(80).optional(),
    bbox: z.object({ x: fraction, y: fraction, w: fraction, h: fraction }).optional(),
  }),
});
const qualityOnlySchema = commonAssessmentSchema.extend({
  qualityOnly: z.literal(true),
  defect: z.null(),
  errors: z.array(z.string().max(300)).max(10),
});
const anomalySchema = commonAssessmentSchema.extend({
  task: z.literal('patchcore_anomaly_detection'),
  modelCategory: z.enum(VISA_MODEL_CATEGORIES),
  anomaly: z.object({
    score: z.number().finite().min(0),
    threshold: z.number().finite().positive(),
    decision: z.enum(['normal', 'anomalous', 'uncertain']),
    scoreSemantics: z.string().min(1).max(180),
    localization: z.object({ x: fraction, y: fraction, w: fraction, h: fraction }).optional(),
    validation: z.object({
      category: z.enum(VISA_MODEL_CATEGORIES),
      status: z.literal('validated'),
      dataset: z.string().min(1).max(100),
      evaluatedAt: z.string().min(1).max(40),
    }),
  }),
});
const assessmentSchema = z.union([predictionSchema, qualityOnlySchema, anomalySchema]);

let provider = null;

function getProvider() {
  if (!provider) provider = env.inspectionProvider === 'http' ? httpProvider : demoProvider;
  return provider;
}
const setProvider = (p) => {
  provider = p; // used by tests; pass null to reset to the configured provider
};

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** Never throws. Always returns an attempt-shaped assessment. */
async function assess(input) {
  const p = getProvider();
  const source = { kind: p.kind, provider: p.name, demo: p.kind === 'demo' };
  try {
    const raw = await p.assess(input);
    const parsed = assessmentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error('Model returned an invalid response: ' + parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).slice(0, 3).join('; '));
    }
    const r = parsed.data;
    if (r.task === 'patchcore_anomaly_detection') {
      if (input.context && input.context.modelCategory && r.modelCategory !== input.context.modelCategory) {
        throw new Error('Model category does not match the requested category.');
      }
      return {
        assessmentStatus: 'assessed',
        quality: Object.fromEntries(Object.entries(r.quality).map(([k, v]) => [k, round1(v)])),
        defect: { detected: r.anomaly.decision === 'anomalous', confidence: null, label: `${r.anomaly.decision} anomaly`, bbox: r.anomaly.localization },
        anomaly: r.anomaly,
        modelCategory: r.modelCategory,
        qualityMeasurements: r.metadata && r.metadata.qualityMeasurements ? r.metadata.qualityMeasurements : null,
        source: { ...source, modelVersion: r.modelVersion },
      };
    }
    return {
      assessmentStatus: 'assessed',
      quality: Object.fromEntries(Object.entries(r.quality).map(([k, v]) => [k, round1(v)])),
      defect: r.defect ? { detected: r.defect.detected, confidence: round1(r.defect.confidence), label: r.defect.label, bbox: r.defect.bbox } : { detected: null, confidence: null },
      assessmentError: r.qualityOnly ? 'This quality-only provider does not include defect inference; no prediction was made.' : undefined,
      modelCategory: r.modelCategory || null,
      qualityMeasurements: r.metadata && r.metadata.qualityMeasurements ? r.metadata.qualityMeasurements : null,
      source: { ...source, modelVersion: r.modelVersion },
    };
  } catch (e) {
    return {
      assessmentStatus: 'failed',
      assessmentError: String(e && e.message ? e.message : e).slice(0, 500),
      quality: { sharpness: null, lighting: null, alignment: null, visibility: null },
      defect: { detected: null, confidence: null },
      qualityMeasurements: null,
      source: { ...source, modelVersion: null },
    };
  }
}

const describeProvider = () => {
  const p = getProvider();
  return { provider: p.name, kind: p.kind, demo: p.kind === 'demo', modelVersion: p.modelVersion || null };
};

async function listModelCategories() {
  const p = getProvider();
  if (typeof p.listCategories === 'function') {
    try {
      const result = await p.listCategories();
      const responseSchema = z.object({
        dataset: z.string().max(100).optional(),
        categories: z.array(z.object({
          category: z.enum(VISA_MODEL_CATEGORIES),
          ready: z.boolean(),
          reason: z.string().max(300).optional(),
          modelVersion: z.string().max(100).optional(),
          anomalyThreshold: z.number().finite().positive().optional(),
          scoreSemantics: z.string().max(180).optional(),
        }).superRefine((item, ctx) => {
          if (item.ready && (!item.modelVersion || item.anomalyThreshold == null || !item.scoreSemantics)) {
            ctx.addIssue({ code: 'custom', message: 'Ready categories require model version, calibrated threshold, and score semantics.' });
          }
        })),
      });
      const parsed = responseSchema.safeParse(result);
      if (!parsed.success) throw new Error('Model category response is invalid.');
      const categories = new Map(parsed.data.categories.map((item) => [item.category, item]));
      return {
        dataset: parsed.data.dataset || 'VisA',
        categories: VISA_MODEL_CATEGORIES.map((category) => categories.get(category) || {
          category,
          ready: false,
          reason: 'Category is not present in the model service registry.',
        }),
      };
    } catch (_) {
      return { dataset: 'VisA', categories: VISA_MODEL_CATEGORIES.map((category) => ({ category, ready: false, reason: 'Model service category registry is unavailable.' })) };
    }
  }
  return {
    dataset: 'VisA',
    categories: VISA_MODEL_CATEGORIES.map((category) => ({ category, ready: false, reason: 'Demo provider does not run category-specific anomaly inference.' })),
  };
}

module.exports = { assess, setProvider, describeProvider, listModelCategories, assessmentSchema };
