const inspectionService = require('../../services/inspectionService');
const { detectImageType } = require('../../utils/helpers');
const crypto = require('crypto');

const good = { modelVersion: 'm-1', quality: { sharpness: 90, lighting: 88, alignment: 91, visibility: 93 }, defect: { detected: false, confidence: 95 } };
const input = () => ({ filePath: '/nonexistent', mimeType: 'image/png', sha256: crypto.randomBytes(32).toString('hex'), context: {} });

afterEach(() => inspectionService.setProvider(null));

describe('inspection provider boundary', () => {
  test('a valid model response is accepted and labelled as a real model result', async () => {
    inspectionService.setProvider({ name: 'stub', kind: 'model', assess: async () => good });
    const r = await inspectionService.assess(input());
    expect(r.assessmentStatus).toBe('assessed');
    expect(r.source).toMatchObject({ kind: 'model', provider: 'stub', modelVersion: 'm-1', demo: false });
    expect(r.defect.confidence).toBe(95);
  });

  test('quality and confidence stay separate fields', async () => {
    inspectionService.setProvider({ name: 'stub', kind: 'model', assess: async () => good });
    const r = await inspectionService.assess(input());
    expect(Object.keys(r.quality).sort()).toEqual(['alignment', 'lighting', 'sharpness', 'visibility']);
    expect(r.defect).toHaveProperty('confidence');
    expect(r.quality).not.toHaveProperty('confidence');
  });

  test('quality-only analysis stores measurements but does not invent a prediction', async () => {
    const qualityMeasurements = { sharpness: { raw: 42.5, unit: 'variance' } };
    inspectionService.setProvider({
      name: 'opencv-quality-only',
      kind: 'model',
      assess: async () => ({
        qualityOnly: true,
        modelVersion: 'opencv-quality-v1',
        quality: { sharpness: 35.4, lighting: 92, alignment: null, visibility: null },
        defect: null,
        errors: ['No compatible defect-detection model or weights are configured; no prediction was made.'],
        metadata: { qualityMeasurements },
      }),
    });
    const r = await inspectionService.assess(input());
    expect(r.assessmentStatus).toBe('assessed');
    expect(r.defect).toEqual({ detected: null, confidence: null });
    expect(r.qualityMeasurements).toEqual(qualityMeasurements);
    expect(r.assessmentError).toMatch(/does not include defect inference/i);
  });

  test('PatchCore result preserves category, raw score, validation and localization separately from confidence', async () => {
    inspectionService.setProvider({
      name: 'patchcore-http',
      kind: 'model',
      assess: async () => ({
        task: 'patchcore_anomaly_detection',
        modelVersion: 'patchcore-pcb1-v1',
        modelCategory: 'pcb1',
        quality: { sharpness: 91, lighting: 93, alignment: null, visibility: null },
        anomaly: {
          score: 0.73,
          threshold: 0.5,
          decision: 'anomalous',
          scoreSemantics: 'PatchCore nearest-neighbor anomaly score; not a probability.',
          localization: { x: 0.2, y: 0.25, w: 0.3, h: 0.2 },
          validation: { category: 'pcb1', status: 'validated', dataset: 'VisA', evaluatedAt: '2026-10-25' },
        },
      }),
    });
    const result = await inspectionService.assess(input());
    expect(result.assessmentStatus).toBe('assessed');
    expect(result.modelCategory).toBe('pcb1');
    expect(result.anomaly).toMatchObject({ score: 0.73, threshold: 0.5, decision: 'anomalous' });
    expect(result.anomaly.validation).toMatchObject({ category: 'pcb1', status: 'validated' });
    expect(result.defect.bbox).toEqual({ x: 0.2, y: 0.25, w: 0.3, h: 0.2 });
    expect(result.defect.confidence).toBeNull();
  });

  test('PatchCore result for a different requested category fails closed', async () => {
    inspectionService.setProvider({
      name: 'patchcore-http',
      kind: 'model',
      assess: async () => ({
        task: 'patchcore_anomaly_detection', modelVersion: 'v1', modelCategory: 'pcb2',
        quality: { sharpness: 90, lighting: 90, alignment: 90, visibility: 90 },
        anomaly: {
          score: 0.2, threshold: 0.5, decision: 'normal', scoreSemantics: 'PatchCore score, not probability.',
          validation: { category: 'pcb2', status: 'validated', dataset: 'VisA', evaluatedAt: '2026-10-25' },
        },
      }),
    });
    const result = await inspectionService.assess({ ...input(), context: { modelCategory: 'pcb1' } });
    expect(result.assessmentStatus).toBe('failed');
    expect(result.assessmentError).toMatch(/does not match the requested category/i);
    expect(result.defect.confidence).toBeNull();
  });

  test.each([
    ['confidence above 100', { ...good, defect: { detected: false, confidence: 150 } }],
    ['negative quality score', { ...good, quality: { ...good.quality, sharpness: -5 } }],
    ['NaN quality score', { ...good, quality: { ...good.quality, lighting: NaN } }],
    ['missing defect block', { modelVersion: 'm', quality: good.quality }],
    ['missing model version', { quality: good.quality, defect: good.defect }],
    ['not an object', 'banana'],
    ['bbox outside 0..1', { ...good, defect: { detected: true, confidence: 90, bbox: { x: 2, y: 0, w: 1, h: 1 } } }],
  ])('invalid model output (%s) becomes a failed assessment, not a result', async (_name, bad) => {
    inspectionService.setProvider({ name: 'stub', kind: 'model', assess: async () => bad });
    const r = await inspectionService.assess(input());
    expect(r.assessmentStatus).toBe('failed');
    expect(r.assessmentError).toBeTruthy();
    expect(r.defect.confidence).toBeNull();
    expect(Object.values(r.quality).every((v) => v === null)).toBe(true); // never invented as 0
  });

  test('a provider that throws or times out never throws out of assess()', async () => {
    inspectionService.setProvider({ name: 'stub', kind: 'model', assess: async () => { throw new Error('connect ECONNREFUSED'); } });
    const r = await inspectionService.assess(input());
    expect(r.assessmentStatus).toBe('failed');
    expect(r.assessmentError).toMatch(/ECONNREFUSED/);
  });

  test('the built-in demo provider is always flagged as demo and is repeatable', async () => {
    const inp = input();
    const a = await inspectionService.assess(inp);
    const b = await inspectionService.assess(inp);
    expect(a.source).toMatchObject({ kind: 'demo', demo: true });
    expect(a).toEqual(b);
    expect(a.assessmentStatus).toBe('assessed');
  });

  test('describeProvider reports demo mode', () => {
    expect(inspectionService.describeProvider()).toMatchObject({ provider: 'demo', demo: true });
  });

  test('model category list reports demo categories unavailable and validates HTTP registry output', async () => {
    const demo = await inspectionService.listModelCategories();
    expect(demo.dataset).toBe('VisA');
    expect(demo.categories).toHaveLength(12);
    expect(demo.categories.every((item) => !item.ready)).toBe(true);

    inspectionService.setProvider({
      name: 'stub-registry',
      kind: 'model',
      listCategories: async () => ({ dataset: 'VisA', categories: [{ category: 'pcb1', ready: true, modelVersion: 'v1', anomalyThreshold: 0.4, scoreSemantics: 'PatchCore score, not probability.' }] }),
      assess: async () => good,
    });
    const configured = await inspectionService.listModelCategories();
    expect(configured.categories.find((item) => item.category === 'pcb1')).toMatchObject({ ready: true, modelVersion: 'v1' });
    expect(configured.categories.find((item) => item.category === 'pcb2').ready).toBe(false);

    inspectionService.setProvider({
      name: 'invalid-registry',
      kind: 'model',
      listCategories: async () => ({ categories: [{ category: 'untrusted', ready: true }] }),
      assess: async () => good,
    });
    const invalid = await inspectionService.listModelCategories();
    expect(invalid.categories.every((item) => !item.ready)).toBe(true);
  });
});

describe('image signature detection (never trust the client MIME type)', () => {
  test('recognises JPEG, PNG and WEBP', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('image/png');
    expect(detectImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
  });
  test('rejects text, HTML, SVG, GIF and empty files', () => {
    expect(detectImageType(Buffer.from('hello world, definitely not an image'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});
