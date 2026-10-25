process.env.MAX_UPLOAD_MB = '1';
const fs = require('fs');
const path = require('path');
const Inspection = require('../../models/Inspection');
const Attempt = require('../../models/Attempt');
const AuditLog = require('../../models/AuditLog');
const { startDb, stopDb, clearDb, makeApi, createUsers, useModel, resetModel, R, GOOD, BAD, png, jpg, webp, env } = require('../helpers/app');

const api = makeApi();
let u;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  useModel();
  u = await createUsers(api);
});
afterEach(async () => {
  resetModel();
  await clearDb();
});
const filesOnDisk = () => (fs.existsSync(env.uploadDir) ? fs.readdirSync(env.uploadDir).filter((f) => !f.startsWith('.')) : []);

describe('create + retrieve', () => {
  test('model category registry is authenticated and reports untrained categories as unavailable', async () => {
    expect((await api.get('/model/categories')).status).toBe(401);
    const response = await api.get('/model/categories', u.inspector.token);
    expect(response.status).toBe(200);
    expect(response.body.data.dataset).toBe('VisA');
    expect(response.body.data.categories).toHaveLength(12);
    expect(response.body.data.categories.every((item) => item.ready === false)).toBe(true);
  });

  test('stores a separate supported model category and rejects unknown categories', async () => {
    const valid = await api.upload('/inspections', u.inspector.token, { componentName: 'PCB panel', modelCategory: 'pcb1' });
    expect(valid.status).toBe(201);
    expect(valid.body.data.inspection.modelCategory).toBe('pcb1');
    expect(valid.body.data.attempt.modelCategory).toBe('pcb1');

    const invalid = await api.upload('/inspections', u.inspector.token, { componentName: 'Unknown part', modelCategory: 'industrial_widget' });
    expect(invalid.status).toBe(400);
    expect(await Inspection.countDocuments()).toBe(1);
  });

  test('creates an inspection with a unique SL- code, first attempt and audit trail', async () => {
    const r = await api.newInspection(u.inspector.token, 'Pump Casing P88', { notes: 'Line 3' });
    expect(r.status).toBe(201);
    const { inspection, attempt, outcome } = r.body.data;
    expect(inspection.code).toMatch(/^SL-\d{4}$/);
    expect(inspection.componentName).toBe('Pump Casing P88');
    expect(attempt.number).toBe(1);
    expect(attempt.hasImage).toBe(true);
    expect(attempt.image.storedName).toBeUndefined(); // storage reference never leaves the server
    expect(outcome.status).toBe('Passed');

    const second = await api.newInspection(u.inspector.token, 'Another Part');
    expect(second.body.data.inspection.code).not.toBe(inspection.code);

    const detail = await api.get(`/inspections/${inspection.code}`, u.inspector.token);
    expect(detail.status).toBe(200);
    expect(detail.body.data.attempts).toHaveLength(1);
    expect(detail.body.data.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['inspection_created', 'evidence_uploaded', 'assessment_completed', 'decision']));
    expect(detail.body.data.permissions.canModify).toBe(true);
  });

  test('inspection is really in MongoDB, with the quality scores and confidence stored separately', async () => {
    useModel(R({ sharpness: 91, lighting: 85, alignment: 88, visibility: 90 }, 93, false));
    const r = await api.newInspection(u.inspector.token);
    const doc = await Inspection.findById(r.body.data.inspection.id);
    expect(doc.status).toBe('Passed');
    expect(doc.latest.confidence).toBe(93);
    expect(doc.latest.quality.sharpness).toBe(91);
    const att = await Attempt.findOne({ inspection: doc._id });
    expect(att.source).toMatchObject({ kind: 'model', provider: 'stub', modelVersion: 'stub-1', demo: false });
    expect(att.image.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('accepts JPG, PNG and WEBP', async () => {
    for (const [buf, name, type] of [[jpg(), 'a.jpg', 'image/jpeg'], [png(), 'a.png', 'image/png'], [webp(), 'a.webp', 'image/webp']]) {
      const r = await api.upload('/inspections', u.inspector.token, { componentName: 'Format test' }, { buffer: buf, filename: name, contentType: type });
      expect(r.status).toBe(201);
      expect(r.body.data.attempt.image.mimeType).toBe(type);
    }
  });

  test('unknown id, malformed id and other people\'s ids all give 404', async () => {
    expect((await api.get('/inspections/SL-9999', u.inspector.token)).status).toBe(404);
    expect((await api.get('/inspections/zzzz', u.inspector.token)).status).toBe(404);
    expect((await api.get('/inspections/507f1f77bcf86cd799439011', u.inspector.token)).status).toBe(404);
  });
});

describe('upload validation', () => {
  test('rejects wrong extension/type, leaves nothing on disk', async () => {
    const r = await api.upload('/inspections', u.inspector.token, { componentName: 'X part' }, { buffer: Buffer.from('hello'), filename: 'notes.txt', contentType: 'text/plain' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/unsupported file type/i);
    expect(filesOnDisk()).toHaveLength(0);
  });

  test('rejects a text file renamed to .png (content is checked, not the name)', async () => {
    const r = await api.upload('/inspections', u.inspector.token, { componentName: 'X part' }, { buffer: Buffer.from('<script>alert(1)</script>'), filename: 'evil.png', contentType: 'image/png' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/not a valid/i);
    expect(filesOnDisk()).toHaveLength(0);
    expect(await Inspection.countDocuments()).toBe(0);
  });

  test('rejects files over the size limit with 413', async () => {
    const big = Buffer.concat([png(0), Buffer.alloc(1.5 * 1024 * 1024)]);
    const r = await api.upload('/inspections', u.inspector.token, { componentName: 'Big part' }, { buffer: big, filename: 'big.png', contentType: 'image/png' });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('FILE_TOO_LARGE');
    expect(filesOnDisk()).toHaveLength(0);
  });

  test('missing image or invalid fields -> 400 and no orphan file or record', async () => {
    const noImg = await api.upload('/inspections', u.inspector.token, { componentName: 'No image' }, null);
    expect(noImg.status).toBe(400);
    const badName = await api.upload('/inspections', u.inspector.token, { componentName: 'x' });
    expect(badName.status).toBe(400);
    expect(badName.body.error.details[0].field).toBe('componentName');
    const badType = await api.upload('/inspections', u.inspector.token, { componentName: 'Fine name', inspectionType: 'Bogus' });
    expect(badType.status).toBe(400);
    expect(filesOnDisk()).toHaveLength(0);
    expect(await Inspection.countDocuments()).toBe(0);
  });

  test('stored file name is random and ignores a hostile client file name', async () => {
    const r = await api.upload('/inspections', u.inspector.token, { componentName: 'Path test' }, { buffer: png(), filename: '../../etc/passwd.png', contentType: 'image/png' });
    expect(r.status).toBe(201);
    const files = filesOnDisk();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(r.body.data.attempt.image.originalName).not.toMatch(/[\\/]/);
  });

  test('unauthenticated and reviewer uploads are refused', async () => {
    expect((await api.newInspection(null)).status).toBe(401);
    expect((await api.newInspection(u.reviewer.token)).status).toBe(403);
    expect(filesOnDisk()).toHaveLength(0);
  });
});

describe('evidence image', () => {
  test('uploaded image is served back (owner, reviewer, admin) but not to other inspectors or anonymous users', async () => {
    const bytes = png(200);
    const r = await api.upload('/inspections', u.inspector.token, { componentName: 'Image test' }, { buffer: bytes, filename: 'p.png', contentType: 'image/png' });
    const code = r.body.data.inspection.code;
    const url = `/inspections/${code}/evidence/1/image`;

    const own = await api.get(url, u.inspector.token).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.compare(own.body, bytes)).toBe(0);

    expect((await api.get(url, u.reviewer.token)).status).toBe(200);
    expect((await api.get(url, u.admin.token)).status).toBe(200);
    expect((await api.get(url, u.inspector2.token)).status).toBe(404);
    expect((await api.get(url)).status).toBe(401);
    expect((await api.get(`/inspections/${code}/evidence/7/image`, u.inspector.token)).status).toBe(404);
  });

  test('missing file on disk -> clean 404, not a crash', async () => {
    const r = await api.newInspection(u.inspector.token);
    fs.readdirSync(env.uploadDir).filter((f) => !f.startsWith('.')).forEach((f) => fs.unlinkSync(path.join(env.uploadDir, f)));
    const img = await api.get(`/inspections/${r.body.data.inspection.code}/evidence/1/image`, u.inspector.token);
    expect(img.status).toBe(404);
    expect(img.body.error.message).toMatch(/missing/i);
  });
});

describe('queue: search, filter, sort, pagination', () => {
  beforeEach(async () => {
    useModel(R(GOOD, 95), R(GOOD, 95), R(GOOD, 88, true), R(BAD, 90), R(GOOD, 60), R(GOOD, 95));
    for (const n of ['Alpha Housing', 'Bravo Shaft', 'Charlie Plate', 'Delta Valve', 'Echo Hub', 'Foxtrot Flange']) {
      expect((await api.newInspection(u.inspector.token, n)).status).toBe(201);
    }
  });

  test('pagination returns correct slices and metadata', async () => {
    const p1 = await api.get('/inspections?limit=4&page=1', u.inspector.token);
    const p2 = await api.get('/inspections?limit=4&page=2', u.inspector.token);
    expect(p1.body.meta).toEqual({ page: 1, limit: 4, total: 6, pages: 2 });
    expect(p1.body.data).toHaveLength(4);
    expect(p2.body.data).toHaveLength(2);
    const ids = new Set([...p1.body.data, ...p2.body.data].map((i) => i.id));
    expect(ids.size).toBe(6);
  });

  test('default order is newest first; sort by name asc/desc works', async () => {
    const newest = await api.get('/inspections', u.inspector.token);
    expect(newest.body.data[0].componentName).toBe('Foxtrot Flange');
    const asc = await api.get('/inspections?sort=componentName&order=asc', u.inspector.token);
    expect(asc.body.data.map((i) => i.componentName)).toEqual(['Alpha Housing', 'Bravo Shaft', 'Charlie Plate', 'Delta Valve', 'Echo Hub', 'Foxtrot Flange']);
    const byConf = await api.get('/inspections?sort=confidence&order=desc', u.inspector.token);
    const confs = byConf.body.data.map((i) => i.latest.confidence);
    expect(confs).toEqual([...confs].sort((a, b) => b - a));
  });

  test('search matches code or component name, case-insensitively', async () => {
    const byName = await api.get('/inspections?q=bravo', u.inspector.token);
    expect(byName.body.data.map((i) => i.componentName)).toEqual(['Bravo Shaft']);
    const code = byName.body.data[0].code;
    const byCode = await api.get(`/inspections?q=${code.toLowerCase()}`, u.inspector.token);
    expect(byCode.body.data).toHaveLength(1);
  });

  test('search text is literal: regex characters and operators cannot be injected', async () => {
    expect((await api.get('/inspections?q=.*', u.inspector.token)).body.data).toHaveLength(0);
    expect((await api.get('/inspections?q=(', u.inspector.token)).status).toBe(200);
    // Express 5 does not turn q[$ne]=x into an object, and the validator only accepts plain strings: it is simply ignored.
    const op = await api.get('/inspections?q[$ne]=x', u.inspector.token);
    expect(op.status).toBe(200);
    expect(op.body.data).toHaveLength(6);
  });

  test('status filter', async () => {
    const all = await api.get('/inspections?limit=100', u.inspector.token);
    const by = (s) => all.body.data.filter((i) => i.status === s).length;
    for (const s of ['Passed', 'Defect Confirmed', 'Reinspection Required', 'Awaiting Human Review']) {
      const r = await api.get(`/inspections?status=${encodeURIComponent(s)}`, u.inspector.token);
      expect(r.body.data).toHaveLength(by(s));
      expect(r.body.data.every((i) => i.status === s)).toBe(true);
    }
    expect((await api.get('/inspections?status=Bogus', u.inspector.token)).status).toBe(400);
  });

  test('invalid paging/sort parameters -> 400', async () => {
    expect((await api.get('/inspections?page=0', u.inspector.token)).status).toBe(400);
    expect((await api.get('/inspections?limit=1000', u.inspector.token)).status).toBe(400);
    expect((await api.get('/inspections?sort=password', u.inspector.token)).status).toBe(400);
  });
});

describe('who can see and change what', () => {
  test('inspectors only see their own; reviewers and admins see all', async () => {
    await api.newInspection(u.inspector.token, 'Ivy part');
    await api.newInspection(u.inspector2.token, 'Ian part');
    const count = async (t) => (await api.get('/inspections', t)).body.meta.total;
    expect(await count(u.inspector.token)).toBe(1);
    expect(await count(u.inspector2.token)).toBe(1);
    expect(await count(u.reviewer.token)).toBe(2);
    expect(await count(u.admin.token)).toBe(2);
  });

  test('PATCH: owner may edit notes; other inspector 404; reviewer 403; reviewer assignment is admin-only', async () => {
    const code = (await api.newInspection(u.inspector.token)).body.data.inspection.code;
    const own = await api.patch(`/inspections/${code}`, u.inspector.token, { notes: 'Re-measured', defectDetails: { severity: 'minor', category: 'scratch' } });
    expect(own.status).toBe(200);
    expect(own.body.data.notes).toBe('Re-measured');
    expect(own.body.data.defectDetails.severity).toBe('minor');
    expect((await api.patch(`/inspections/${code}`, u.inspector2.token, { notes: 'hack' })).status).toBe(404);
    expect((await api.patch(`/inspections/${code}`, u.reviewer.token, { notes: 'hack' })).status).toBe(403);
    expect((await api.patch(`/inspections/${code}`, u.inspector.token, { assignedReviewer: u.reviewer.id })).status).toBe(403);
    const assigned = await api.patch(`/inspections/${code}`, u.admin.token, { assignedReviewer: u.reviewer.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.assignedReviewer.name).toBe('Rae Reviewer');
    expect((await api.patch(`/inspections/${code}`, u.admin.token, { assignedReviewer: u.inspector.id })).status).toBe(400);
    expect((await api.patch(`/inspections/${code}`, u.inspector.token, {})).status).toBe(400);
  });

  test('status cannot be changed through PATCH (mass-assignment protection)', async () => {
    useModel(R(BAD, 90));
    const code = (await api.newInspection(u.inspector.token)).body.data.inspection.code;
    await api.patch(`/inspections/${code}`, u.inspector.token, { notes: 'try', status: 'Passed' });
    expect((await Inspection.findOne({ code })).status).toBe('Reinspection Required');
  });

  test('DELETE is admin-only and is a soft delete that keeps the audit trail', async () => {
    const created = await api.newInspection(u.inspector.token);
    const { code, id } = created.body.data.inspection;
    expect((await api.del(`/inspections/${code}`, u.inspector.token)).status).toBe(403);
    expect((await api.del(`/inspections/${code}`, u.admin.token)).status).toBe(200);
    expect((await api.get(`/inspections/${code}`, u.admin.token)).status).toBe(404);
    expect((await api.get('/inspections', u.admin.token)).body.meta.total).toBe(0);
    expect((await Inspection.findById(id)).deletedAt).toBeTruthy();
    expect(await AuditLog.countDocuments({ inspection: id, action: 'inspection_deleted' })).toBe(1);
  });
});

describe('recapture workflow', () => {
  test('recapture creates a NEW attempt, keeps the old one, and waits for Second Look', async () => {
    useModel(R(BAD, 61, true), R(GOOD, 92, false));
    const first = await api.newInspection(u.inspector.token, 'Housing A104');
    const { code, id } = first.body.data.inspection;
    expect(first.body.data.outcome.status).toBe('Reinspection Required');
    expect(first.body.data.outcome.recommendations.length).toBeGreaterThan(0);

    const rec = await api.upload(`/inspections/${code}/recapture`, u.inspector.token);
    expect(rec.status).toBe(201);
    expect(rec.body.data.attempt.number).toBe(2);
    expect(rec.body.data.attempt.evaluated).toBe(false);
    expect(rec.body.data.inspection.status).toBe('Reinspection Required'); // not decided yet

    const attempts = await Attempt.find({ inspection: id }).sort({ number: 1 });
    expect(attempts).toHaveLength(2);
    expect(attempts[0].quality.sharpness).toBe(30); // original assessment preserved untouched
    expect(attempts[0].evaluated).toBe(true);
    expect(attempts[0].image.storedName).not.toBe(attempts[1].image.storedName);
    expect(filesOnDisk()).toHaveLength(2); // both images kept

    const ev = await api.get(`/inspections/${code}/evidence`, u.inspector.token);
    expect(ev.body.data.map((a) => a.number)).toEqual([1, 2]);
    expect(ev.body.data[1].quality.sharpness).toBe(90);
  });

  test('attempt history lets the UI show quality changes between attempts', async () => {
    useModel(R({ sharpness: 34, lighting: 41, alignment: 70, visibility: 78 }, 61, true), R(GOOD, 92, false));
    const code = (await api.newInspection(u.inspector.token)).body.data.inspection.code;
    await api.upload(`/inspections/${code}/recapture`, u.inspector.token);
    const { attempts } = (await api.get(`/inspections/${code}`, u.inspector.token)).body.data;
    expect(attempts.map((a) => a.number)).toEqual([1, 2]);
    expect(attempts[1].quality.sharpness - attempts[0].quality.sharpness).toBe(56);
    expect(attempts[1].quality.lighting - attempts[0].quality.lighting).toBe(49);
    expect(attempts[1].evidence.label).toBe('Adequate');
  });

  test('Run Second Look evaluates the recapture; running it again without new evidence is refused', async () => {
    useModel(R(BAD, 61, true), R(GOOD, 92, false));
    const code = (await api.newInspection(u.inspector.token)).body.data.inspection.code;
    await api.upload(`/inspections/${code}/recapture`, u.inspector.token);

    const sl = await api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'second_look' });
    expect(sl.status).toBe(200);
    expect(sl.body.data.outcome.status).toBe('Passed');
    expect(sl.body.data.outcome.rule).toBe('PASSED');

    const again = await api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'second_look' });
    expect(again.status).toBe(409);
    expect((await api.upload(`/inspections/${code}/recapture`, u.inspector.token)).status).toBe(409); // passed: no more recaptures
  });

  test('guard rails: second look needs new evidence; only one pending recapture; others cannot recapture', async () => {
    useModel(R(BAD, 61, true), R(BAD, 70, false));
    const code = (await api.newInspection(u.inspector.token)).body.data.inspection.code;
    expect((await api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'second_look' })).status).toBe(409); // nothing new
    expect((await api.upload(`/inspections/${code}/recapture`, u.inspector2.token)).status).toBe(404);
    expect((await api.upload(`/inspections/${code}/recapture`, u.reviewer.token)).status).toBe(403);
    expect((await api.upload(`/inspections/${code}/recapture`, u.inspector.token)).status).toBe(201);
    expect((await api.upload(`/inspections/${code}/recapture`, u.inspector.token)).status).toBe(409); // previous one not evaluated yet
    expect((await Attempt.countDocuments())).toBe(2);
    expect(filesOnDisk()).toHaveLength(2); // the refused upload left no file behind
  });

  test('every decision is recorded, nothing is overwritten', async () => {
    useModel(R(BAD, 61, true), R(BAD, 70, false), R(GOOD, 92, false));
    const created = await api.newInspection(u.inspector.token);
    const { code, id } = created.body.data.inspection;
    await api.upload(`/inspections/${code}/recapture`, u.inspector.token);
    const sl1 = await api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'second_look' });
    expect(sl1.body.data.outcome.status).toBe('Reinspection Required'); // still blurry
    await api.upload(`/inspections/${code}/recapture`, u.inspector.token);
    const sl2 = await api.post(`/inspections/${code}/decision`, u.inspector.token, { action: 'second_look' });
    expect(sl2.body.data.outcome.status).toBe('Passed');

    const attempts = await Attempt.find({ inspection: id }).sort({ number: 1 });
    expect(attempts.map((a) => a.outcome)).toEqual(['Reinspection Required', 'Reinspection Required', 'Passed']);
    const hist = await api.get(`/inspections/${code}/decision`, u.inspector.token);
    expect(hist.body.data.map((e) => e.to)).toEqual(['Reinspection Required', 'Reinspection Required', 'Passed']);
    expect(hist.body.data.every((e) => e.reason && e.rule)).toBe(true);
  });
});
