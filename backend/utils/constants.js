'use strict';

const ROLES = { ADMIN: 'admin', INSPECTOR: 'inspector', REVIEWER: 'reviewer' };

// Same four statuses the original dashboard used.
const STATUS = {
  REINSPECT: 'Reinspection Required',
  REVIEW: 'Awaiting Human Review',
  DEFECT: 'Defect Confirmed',
  PASSED: 'Passed',
};

const STATUS_LIST = Object.values(STATUS);
const INSPECTION_TYPES = ['Surface defect', 'Dimensional check', 'Weld seam', 'Assembly check'];
const VISA_MODEL_CATEGORIES = ['pcb1', 'pcb2', 'pcb3', 'pcb4', 'capsules', 'candle', 'macaroni1', 'macaroni2', 'cashew', 'chewinggum', 'fryum', 'pipe_fryum'];
const QUALITY_METRICS = ['sharpness', 'lighting', 'alignment', 'visibility'];
const REVIEW_TYPES = { ESCALATION: 'escalation', DEFECT_SIGNOFF: 'defect_signoff' };
const REVIEW_DECISIONS = ['approve', 'reject', 'request_recapture', 'escalate'];

module.exports = { ROLES, STATUS, STATUS_LIST, INSPECTION_TYPES, VISA_MODEL_CATEGORIES, QUALITY_METRICS, REVIEW_TYPES, REVIEW_DECISIONS };
