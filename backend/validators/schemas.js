'use strict';
const { z } = require('zod');
const { INSPECTION_TYPES, VISA_MODEL_CATEGORIES, STATUS_LIST, REVIEW_DECISIONS, ROLES } = require('../utils/constants');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
// Zod 4 style: one `error` callback decides the message for missing vs wrong-type input.
const typeErr = (label) => (iss) => (iss.input === undefined ? `${label} is required` : `${label} must be text`);
const trimmed = (min, max, label = 'Value') =>
  z.string({ error: typeErr(label) }).trim().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be at most ${max} characters`);

const password = z
  .string({ error: typeErr('Password') })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters') // bcrypt only uses the first 72 bytes
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

const email = z.string({ error: typeErr('Email') }).trim().toLowerCase().email('Enter a valid email address').max(254);

// Query-string numbers arrive as strings.
const intParam = (def, min, max) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : Number(v)), z.number().int().min(min).max(max));

const dateParam = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date (use YYYY-MM-DD)')
  .optional();

const auth = {
  register: z.object({ name: trimmed(2, 80, 'Name'), email, password }),
  login: z.object({ email, password: z.string({ error: typeErr('Password') }).min(1, 'Password is required').max(200) }),
};

const inspections = {
  // multipart/form-data: every field is a string
  create: z.object({
    componentName: trimmed(2, 120, 'Component name'),
    inspectionType: z.enum(INSPECTION_TYPES).default(INSPECTION_TYPES[0]),
    modelCategory: z.enum(VISA_MODEL_CATEGORIES).optional(),
    notes: z.string().trim().max(2000).optional().default(''),
    defectCategory: z.string().trim().max(80).optional().default(''),
    defectSeverity: z.enum(['', 'minor', 'major', 'critical']).optional().default(''),
    defectDescription: z.string().trim().max(1000).optional().default(''),
  }),
  update: z
    .object({
      componentName: trimmed(2, 120, 'Component name').optional(),
      notes: z.string().trim().max(2000).optional(),
      defectDetails: z
        .object({
          category: z.string().trim().max(80).optional(),
          severity: z.enum(['', 'minor', 'major', 'critical']).optional(),
          description: z.string().trim().max(1000).optional(),
        })
        .optional(),
      assignedReviewer: objectId.nullable().optional(),
    })
    .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update'),
  list: z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(STATUS_LIST).optional(),
    page: intParam(1, 1, 100000),
    limit: intParam(10, 1, 100),
    sort: z.enum(['createdAt', 'updatedAt', 'code', 'componentName', 'status', 'confidence']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    from: dateParam,
    to: dateParam,
  }),
  decision: z.discriminatedUnion('action', [
    z.object({ action: z.literal('second_look') }),
    z.object({
      action: z.literal('escalate'),
      reason: trimmed(3, 200, 'Reason'),
      note: z.string().trim().max(1000).optional().default(''),
    }),
  ]),
  idParam: z.object({ id: z.string().trim().min(3).max(40) }), // SL-1042 or a Mongo id
  attemptParam: z.object({ id: z.string().trim().min(3).max(40), attempt: intParam(1, 1, 1000) }),
  evidenceList: z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(STATUS_LIST).optional(),
    page: intParam(1, 1, 100000),
    limit: intParam(15, 1, 100),
  }),
};

const reviews = {
  list: z.object({
    status: z.enum(['open', 'decided', 'all']).default('open'),
    type: z.enum(['escalation', 'defect_signoff']).optional(),
    page: intParam(1, 1, 100000),
    limit: intParam(10, 1, 100),
  }),
  decide: z
    .object({
      decision: z.enum(REVIEW_DECISIONS),
      verdict: z.enum(['pass', 'defect']).optional(),
      comment: z.string().trim().max(1000).optional().default(''),
    })
    .superRefine((v, ctx) => {
      if (v.decision !== 'approve' && v.comment.length < 3) {
        ctx.addIssue({ code: 'custom', path: ['comment'], message: 'A comment of at least 3 characters is required for this action' });
      }
      if (v.decision !== 'approve' && v.verdict) {
        ctx.addIssue({ code: 'custom', path: ['verdict'], message: 'A verdict is only used when approving' });
      }
    }),
  idParam: z.object({ id: objectId }),
};

const analytics = {
  range: z.object({ from: dateParam, to: dateParam }),
};

const settings = {
  app: z
    .object({
      confidenceThreshold: z.number().int().min(50).max(99).optional(),
      minQualityScore: z.number().int().min(20).max(95).optional(),
      adequateQualityScore: z.number().int().min(30).max(99).optional(),
      maxAttempts: z.number().int().min(1).max(10).optional(),
      requireDefectSignoff: z.boolean().optional(),
    })
    .strict()
    .refine((o) => Object.keys(o).length > 0, 'Provide at least one setting'),
  me: z
    .object({
      name: trimmed(2, 80, 'Name').optional(),
      preferences: z.object({ theme: z.enum(['system', 'light', 'dark']).optional() }).strict().optional(),
    })
    .strict()
    .refine((o) => Object.keys(o).length > 0, 'Provide at least one field'),
};

const users = {
  list: z.object({ page: intParam(1, 1, 100000), limit: intParam(20, 1, 100), role: z.enum(Object.values(ROLES)).optional() }),
  update: z
    .object({ role: z.enum(Object.values(ROLES)).optional(), active: z.boolean().optional() })
    .strict()
    .refine((o) => Object.keys(o).length > 0, 'Provide role and/or active'),
  idParam: z.object({ id: objectId }),
};

module.exports = { auth, inspections, reviews, analytics, settings, users };
