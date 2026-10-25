/* SecondLook frontend. Same look and views as the original demo; all data now comes from the API (MongoDB).
   Only the session token (sessionStorage) is kept in the browser; inspections, evidence, decisions and settings live on the server. */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fdt = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const pv = (v) => (v == null ? '—' : Math.round(v * 10) / 10 + '%');
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

const QN = [['sharpness', 'Sharpness'], ['lighting', 'Lighting'], ['alignment', 'Alignment'], ['visibility', 'Visibility']];
const ST = ['Reinspection Required', 'Awaiting Human Review', 'Defect Confirmed', 'Passed'];
const SC = { 'Reinspection Required': 'a', 'Awaiting Human Review': 'b', 'Defect Confirmed': 'r', Passed: 'g' };
const EC = { Adequate: 'g', Marginal: 'a', Insufficient: 'r', Unavailable: 'n' };
const STEPS = ['Inspect', 'Assess Evidence', 'Recapture', 'Verify', 'Approve or Escalate'];
const TYPES = ['Surface defect', 'Dimensional check', 'Weld seam', 'Assembly check'];
const P = { ov: 'Overview', new: 'New Inspection', queue: 'Inspection Queue', hist: 'Evidence History', review: 'Human Review', an: 'Analytics', set: 'Settings' };
const ACT = {
  inspection_created: 'Inspection created', evidence_uploaded: 'Evidence uploaded', recapture_uploaded: 'Recapture uploaded',
  assessment_completed: 'Evidence assessed', assessment_failed: 'Assessment failed', decision: 'Automatic decision', second_look: 'Second Look run',
  escalated: 'Escalated to human review', review_opened: 'Review opened', review_decision: 'Reviewer decision', review_escalated: 'Review escalated to administrator',
  inspection_updated: 'Inspection edited', inspection_deleted: 'Inspection deleted', settings_updated: 'Settings changed',
};
const RD = { approve: 'Approve', reject: 'Reject', request_recapture: 'Request recapture', escalate: 'Escalate to administrator' };

const IC = {
  grid: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  plus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', bars: '<path d="M3 3v18h18M7 16v-6M12 16V6M17 16v-4"/>',
  sl: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>', se: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
  zi: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>', zo: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  rs: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>', mn: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  up: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  rv: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
};
const ic = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;

// Illustrative part picture, used ONLY for sample records that have no uploaded image.
const part = (b) => `<svg viewBox="0 0 640 440" role="img" aria-label="Machined metal housing (illustrative rendering)"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9ced6"/><stop offset=".5" stop-color="#e8ebef"/><stop offset="1" stop-color="#9aa2ae"/></linearGradient><radialGradient id="bg" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#4a5262"/><stop offset="1" stop-color="#1f2430"/></radialGradient><filter id="bl"><feGaussianBlur stdDeviation="${b.toFixed(1)}"/></filter></defs><rect width="640" height="440" fill="url(#bg)"/><g filter="url(#bl)"><rect x="90" y="60" width="460" height="320" rx="28" fill="url(#m)" stroke="#7b8391" stroke-width="3"/>${Array.from({ length: 16 }, (_, i) => `<line x1="100" x2="540" y1="${75 + i * 19}" y2="${75 + i * 19}" stroke="#8a919d" stroke-opacity=".25"/>`).join('')}<circle cx="320" cy="210" r="92" fill="#6b7380"/><circle cx="320" cy="210" r="76" fill="#3a404c"/><circle cx="320" cy="210" r="52" fill="#1b1f27"/>${[[140, 110], [500, 110], [140, 330], [500, 330]].map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="17" fill="#444b57"/><circle cx="${p[0]}" cy="${p[1]}" r="9" fill="#1b1f27"/>`).join('')}</g></svg>`;

// ---------------------------------------------------------------------------------------------------- state
const fresh = () => ({
  user: null, cfg: null, authMode: 'login', authErr: '', authDetails: [], af: { name: '', email: '', password: '' },
  v: 'ov', nav: false, toast: null, net: '', busy: false, booting: true,
  dash: null, list: null, listLoading: false, q: '', f: 'All', sort: 'createdAt', order: 'desc', page: 1,
  sel: null, detail: null, detailLoading: false, at: null, z: 1, ov: true, imgs: {},
  hist: null, histPage: 1, an: null, anFrom: '', anTo: '', set: null, setForm: null, users: null,
  rv: null, rvTab: 'open', rvPage: 1, rvSel: null, rvDetail: null, rf: { decision: 'approve', verdict: '', comment: '' },
  fb: { new: {}, rc: {} }, name: '', type: TYPES[0], modelCategory: '', categories: [], notes: '', m: false, formErr: '', formDetails: [],
});
let S = fresh();
const role = () => (S.user ? S.user.role : '');
const isAdmin = () => role() === 'admin';
const canCreate = () => ['inspector', 'admin'].includes(role());
const canReview = () => ['reviewer', 'admin'].includes(role());

// ---------------------------------------------------------------------------------------------------- helpers
function toast(t, err) {
  S.toast = { t, err: !!err };
  render();
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { S.toast = null; render(); }, err ? 4500 : 2600);
}
function handleErr(e) {
  if (e && (e.code === 'SESSION_EXPIRED' || (e.status === 401 && !S.user))) return; // onExpired already switched to sign-in
  if (e && e.code === 'NETWORK') { S.net = e.message; render(); return; }
  toast((e && e.message) || 'Something went wrong.', true);
}
async function run(fn) { try { S.net = ''; return await fn(); } catch (e) { handleErr(e); return undefined; } }
const detailsList = (e) => (e && Array.isArray(e.details) ? e.details.map((d) => (d.field ? cap(d.field) + ': ' : '') + d.message) : []);

function applyTheme(t) { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const meter = (l, v) => v == null
  ? `<div><div class="row k"><span>${l}</span><span class="sp"></span><b style="color:var(--mu)">Not calculated</b></div><div class="bar" role="img" aria-label="${l} not calculated"></div></div>`
  : `<div><div class="row k"><span>${l}</span><span class="sp"></span><b style="color:var(--tx)">${Math.round(v)}%</b></div><div class="bar" role="img" aria-label="${l} ${Math.round(v)} percent"><i style="width:${v}%;background:${v < ((S.cfg && S.cfg.app.minQualityScore) || 60) ? 'var(--r)' : v < ((S.cfg && S.cfg.app.adequateQualityScore) || 80) ? '#d97706' : '#16a34a'}"></i></div></div>`;
const bdg = (s) => `<span class="bdg ${SC[s] || 'n'}">${esc(s)}</span>`;
const evb = (l) => `<span class="bdg ${EC[l] || 'n'}">${esc(l || 'Unavailable')}</span>`;
function srcLabel(a) {
  if (!a) return '';
  if (a.assessmentStatus === 'failed') return '<span class="bdg r">Assessment failed</span>';
  if (a.source.kind === 'seed') return '<span class="sim">Sample data</span>';
  if (a.source.demo) return '<span class="sim">Demo result (mock, not a real prediction)</span>';
  if (a.anomaly && a.anomaly.score != null) return `PatchCore · ${esc(a.modelCategory || 'category unknown')}`;
  if (a.qualityMeasurements) return '<span class="bdg a">OpenCV quality only · no defect model</span>';
  return `Model ${esc(a.source.modelVersion || a.source.provider)}`;
}
const delta = (cur, prev) => (cur == null || prev == null || cur === prev ? '' : `<span class="dl ${cur > prev ? 'up' : 'dn'}">${cur > prev ? '▲' : '▼'}${Math.abs(Math.round((cur - prev) * 10) / 10)}</span>`);

// ---------------------------------------------------------------------------------------------------- data loading
async function loadDash() { const r = await run(() => API.get('/analytics/dashboard')); if (r) S.dash = r.data; }
async function loadList() {
  S.listLoading = true;
  const r = await run(() => API.get('/inspections' + API.qs({ q: S.q.trim(), status: S.f, page: S.page, limit: 10, sort: S.sort, order: S.order })));
  S.listLoading = false;
  if (r) { S.list = { items: r.data, meta: r.meta }; }
  render();
}
async function loadDetail(code) {
  if (!code) { S.detail = null; return; }
  S.detailLoading = true; render();
  try {
    S.detail = (await API.get('/inspections/' + encodeURIComponent(code))).data;
  } catch (e) {
    S.detail = null;
    if (e.status === 404) { S.sel = null; } else handleErr(e);
  }
  S.detailLoading = false;
  render();
}
async function loadHist() { const r = await run(() => API.get('/evidence' + API.qs({ q: S.q.trim(), status: S.f, page: S.histPage, limit: 15 }))); if (r) S.hist = { items: r.data, meta: r.meta }; render(); }
async function loadAn() { const r = await run(() => API.get('/analytics/summary' + API.qs({ from: S.anFrom, to: S.anTo }))); if (r) S.an = r.data; render(); }
async function loadSet() {
  const r = await run(() => API.get('/settings'));
  if (r) { S.set = r.data; S.cfg = r.data; S.setForm = { ...r.data.app }; }
  if (isAdmin()) { const u = await run(() => API.get('/users?limit=100')); if (u) S.users = u.data; }
  render();
}
async function loadModelCategories() {
  const r = await run(() => API.get('/model/categories'));
  if (r) {
    S.categories = r.data.categories || [];
    render();
  }
}
async function loadReviews() { const r = await run(() => API.get('/reviews' + API.qs({ status: S.rvTab, page: S.rvPage, limit: 10 }))); if (r) S.rv = { items: r.data, meta: r.meta }; render(); }
async function loadReviewDetail(id) {
  S.rvSel = id; S.rvDetail = null; S.rf = { decision: 'approve', verdict: '', comment: '' }; S.at = null; S.formErr = ''; render();
  const r = await run(() => API.get('/reviews/' + id));
  if (r) S.rvDetail = r.data; else S.rvSel = null;
  render();
}
async function refreshAll() {
  await Promise.all([loadDash(), loadList(), S.sel ? loadDetail(S.sel) : null]);
}

function go(v, keep) {
  S.v = v; S.nav = false; S.formErr = ''; S.formDetails = [];
  if (!keep) { S.q = ''; S.f = 'All'; S.page = 1; S.histPage = 1; }
  S.at = null; S.z = 1;
  render(); scrollTo(0, 0);
  if (v === 'ov') { initOverview(); }
  else if (v === 'queue') loadList();
  else if (v === 'hist') loadHist();
  else if (v === 'an') loadAn();
  else if (v === 'set') loadSet();
  else if (v === 'review') { S.rvSel = null; S.rvDetail = null; loadReviews(); }
  if (v === 'new') loadModelCategories();
}
async function initOverview() {
  await Promise.all([loadDash(), loadList()]);
  if (!S.sel && S.list && S.list.items.length) S.sel = S.list.items[0].code;
  if (S.sel) await loadDetail(S.sel); else { S.detail = null; render(); }
}
function pick(code) { S.sel = code; S.at = null; S.z = 1; S.v = 'ov'; S.fb.rc = {}; render(); scrollTo(0, 0); loadDash(); loadDetail(code); }
function reloadCurrent() { if (S.v === 'hist') loadHist(); else loadList(); }
let searchTimer;
function onSearch(v) { S.q = v; clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.page = 1; S.histPage = 1; reloadCurrent(); }, 300); }
function setFilter(v) { S.f = v; S.page = 1; S.histPage = 1; reloadCurrent(); }
function sortBy(f) { if (S.sort === f) S.order = S.order === 'asc' ? 'desc' : 'asc'; else { S.sort = f; S.order = f === 'componentName' || f === 'code' ? 'asc' : 'desc'; } S.page = 1; loadList(); }
function pgQueue(p) { S.page = p; loadList(); }
function pgHist(p) { S.histPage = p; loadHist(); }
function pgRev(p) { S.rvPage = p; loadReviews(); }

// image blobs (the image endpoint needs the Authorization header, so <img src=url> cannot be used)
function ensureImg(code, n) {
  const k = code + '#' + n;
  if (S.imgs[k] !== undefined) return;
  S.imgs[k] = null;
  API.image(code, n).then((u) => { S.imgs[k] = u; render(); }).catch(() => { S.imgs[k] = 'error'; render(); });
}

// ---------------------------------------------------------------------------------------------------- auth
function authView() {
  const reg = S.authMode === 'register';
  const f = S.af;
  return `<div class="auth"><form class="card authc" onsubmit="return submitAuth(event)" novalidate>
  <div class="logo"><i>${ic('se', 16)}</i>SecondLook</div><h2>${reg ? 'Create your account' : 'Sign in'}</h2>
  ${S.booting ? '<p class="k">Checking your session…</p>' : ''}
  ${S.authErr ? `<div class="er" role="alert">${esc(S.authErr)}${S.authDetails.length ? `<ul>${S.authDetails.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</div>` : ''}
  ${reg ? `<div class="fld"><label class="k" for="an">Full name</label><input id="an" type="text" autocomplete="name" value="${esc(f.name)}" oninput="S.af.name=this.value"></div>` : ''}
  <div class="fld"><label class="k" for="ae">Email</label><input id="ae" type="email" autocomplete="username" value="${esc(f.email)}" oninput="S.af.email=this.value"></div>
  <div class="fld"><label class="k" for="ap">Password${reg ? ' (8+ characters, with a letter and a number)' : ''}</label><input id="ap" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" oninput="S.af.password=this.value"></div>
  <button class="btn pri" style="width:100%;margin-top:16px" ${S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spin"></span>Please wait…' : reg ? 'Create account' : 'Sign in'}</button>
  <p class="hint" style="text-align:center">${reg ? 'Already have an account?' : 'New here?'} <button type="button" class="lnk" onclick="S.authMode='${reg ? 'login' : 'register'}';S.authErr='';S.authDetails=[];render()">${reg ? 'Sign in' : 'Create an account'}</button></p>
  </form></div>`;
}
async function submitAuth(ev) {
  ev.preventDefault();
  if (S.busy) return false;
  const reg = S.authMode === 'register', f = S.af;
  S.authErr = ''; S.authDetails = [];
  if ((reg && f.name.trim().length < 2) || !f.email.trim() || !f.password) {
    S.authErr = reg ? 'Enter your name, email and a password.' : 'Enter your email and password.';
    render(); return false;
  }
  S.busy = true; render();
  try {
    const r = reg ? await API.register({ name: f.name.trim(), email: f.email.trim(), password: f.password }) : await API.login({ email: f.email.trim(), password: f.password });
    API.store.set(r.data.token);
    S.user = r.data.user; S.af.password = '';
    await afterLogin();
  } catch (e) {
    S.authErr = e.code === 'NETWORK' ? e.message : e.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : e.message;
    S.authDetails = detailsList(e);
    S.af.password = '';
  }
  S.busy = false; render();
  return false;
}
async function afterLogin() {
  applyTheme(S.user.preferences && S.user.preferences.theme);
  const r = await API.get('/settings');
  S.cfg = r.data; S.set = r.data; S.setForm = { ...r.data.app };
  S.v = 'ov'; S.sel = null; S.detail = null; S.list = null; S.dash = null;
  render();
  initOverview();
}
async function signOut() {
  try { await API.logout(); } catch (_) {}
  API.store.set(''); S = fresh(); S.booting = false; applyTheme('system'); render();
}
API.onExpired((msg) => { const mode = S.authMode; S = fresh(); S.booting = false; S.authMode = mode; S.authErr = msg || 'Your session has expired. Please sign in again.'; render(); });

// ---------------------------------------------------------------------------------------------------- shared pieces
function stepper(ins, last) {
  let cur = 1, fin = false;
  if (ins.status === 'Reinspection Required') cur = last && !last.evaluated ? 3 : 2;
  else if (ins.reviewOpen) cur = 4;
  else fin = true;
  return `<div class="stp" aria-label="Inspection workflow">${STEPS.map((s, i) => `<div class="st ${fin || i < cur ? 'd' : ''} ${!fin && i === cur ? 'c' : ''}">${fin || i < cur ? '✓ ' : ''}${s}</div>`).join('')}</div>`;
}

// c = { code, name, type, attempts }
function imgPanel(c) {
  const at = c.attempts, k = at.length;
  if (!k) return '<div class="card"><div class="empty">No evidence has been stored for this inspection.</div></div>';
  const i = S.at == null ? k - 1 : Math.min(S.at, k - 1), a = at[i];
  let media;
  const sample = !a.hasImage;
  if (a.hasImage) {
    ensureImg(c.code, a.number);
    const u = S.imgs[c.code + '#' + a.number];
    media = u && u !== 'error' ? `<img src="${u}" alt="Evidence image for ${esc(c.name)}, attempt ${a.number}">`
      : `<div style="aspect-ratio:640/440;display:grid;place-items:center;color:#c9d2e6">${u === 'error' ? 'This image could not be loaded.' : '<span><span class="spin"></span>Loading image…</span>'}</div>`;
  } else {
    const sh = a.quality.sharpness == null ? 100 : a.quality.sharpness;
    media = part((100 - sh) / 12) + `<div class="lt" style="opacity:${Math.max(0, (78 - (a.quality.lighting == null ? 100 : a.quality.lighting)) / 60).toFixed(2)}"></div>`;
  }
  const bb = a.defect && a.defect.bbox;
  const col = a.defect && a.defect.detected ? '#ef4444' : '#22c55e';
  const overlay = S.ov && bb ? `<div class="bx" style="left:${bb.x * 100}%;top:${bb.y * 100}%;width:${bb.w * 100}%;height:${bb.h * 100}%;border-color:${col}"><span style="background:${col}">${a.anomaly ? 'Anomaly map region' : 'Region of interest'}${a.defect.confidence != null ? ' · ' + Math.round(a.defect.confidence) + '%' : ''}${a.source.demo ? ' (demo)' : ''}</span></div>` : '';
  return `<div class="card"><div class="row" style="margin-bottom:10px"><div><b>${esc(c.code)}</b> · ${esc(c.name)}<div class="k">${esc(c.type)} · attempt ${a.number} of ${k} · ${srcLabel(a)}</div></div><span class="sp"></span>
  ${at.map((x, j) => `<button class="btn sm" style="${j === i ? 'background:var(--pri);color:#fff' : ''}" onclick="S.at=${j};render()">Attempt ${x.number}</button>`).join('')}</div>
  <div class="imgw"><div class="imgi" style="transform:scale(${S.z})">${media}${overlay}</div></div>
  <div class="row" style="margin:10px 0"><button class="ib" aria-label="Zoom in" onclick="S.z=Math.min(3,S.z+.25);render()">${ic('zi')}</button><button class="ib" aria-label="Zoom out" onclick="S.z=Math.max(1,S.z-.25);render()">${ic('zo')}</button><button class="ib" aria-label="Reset zoom" onclick="S.z=1;render()">${ic('rs')}</button><span class="k">${Math.round(S.z * 100)}%</span><span class="sp"></span>
  ${bb ? `<button class="btn sm" onclick="S.ov=false;render()" style="${!S.ov ? 'background:var(--pri);color:#fff' : ''}">Original</button><button class="btn sm" onclick="S.ov=true;render()" style="${S.ov ? 'background:var(--pri);color:#fff' : ''}">Evidence overlay</button>` : ''}</div>
  <div class="g4" style="margin:0;gap:10px">${QN.map(([key, label]) => meter(label, a.quality[key])).join('')}</div>
  ${a.modelCategory ? `<div class="k" style="margin-top:12px"><b style="color:var(--tx)">Model category: ${esc(a.modelCategory)}</b>${a.anomaly && a.anomaly.score != null ? `<div>PatchCore anomaly score: ${esc(a.anomaly.score)} · calibrated threshold: ${esc(a.anomaly.threshold)} · ${esc(a.anomaly.decision)}</div><div>${esc(a.anomaly.scoreSemantics || 'Raw anomaly score; not a probability.')}</div>` : '<div>No trained, validated model is registered for this category; no anomaly prediction was made.</div>'}</div>` : ''}
  ${a.qualityMeasurements ? `<div class="k" style="margin-top:12px"><b style="color:var(--tx)">OpenCV measurements</b><div>Sharpness: Laplacian variance ${esc(a.qualityMeasurements.sharpness && a.qualityMeasurements.sharpness.value)} ${esc(a.qualityMeasurements.sharpness && a.qualityMeasurements.sharpness.unit)} · ${esc(a.qualityMeasurements.sharpness && a.qualityMeasurements.sharpness.status)}</div><div>Lighting: mean ${esc(a.qualityMeasurements.lighting && a.qualityMeasurements.lighting.mean_gray)} / median ${esc(a.qualityMeasurements.lighting && a.qualityMeasurements.lighting.median_gray)} (0–255) · clipped ${esc(a.qualityMeasurements.lighting && a.qualityMeasurements.lighting.clipped_percent)}% · ${esc(a.qualityMeasurements.lighting && a.qualityMeasurements.lighting.status)}</div><div>Alignment and visibility: not calculated without component geometry or a reference image.</div><div>${esc(a.qualityMeasurements.calibration || '')}</div></div>` : ''}
  <p class="k" style="margin:10px 0 0">Evidence quality describes the image itself. Model confidence describes the prediction. They are scored separately.${a.assessmentStatus === 'failed' ? ' The automated assessment failed for this attempt, so no scores are available.' : ''}${sample ? ' This sample record has no uploaded image; the part picture is an illustrative rendering.' : ''}${a.source.demo && !sample ? ' Scores come from the built-in demo provider, not a real AI model.' : ''}</p></div>`;
}

function decideCard(d) {
  const ins = d.inspection, last = d.attempts[d.attempts.length - 1];
  const T = S.cfg.app.confidenceThreshold;
  const anomaly = last && last.anomaly && last.anomaly.score != null ? last.anomaly : null;
  const act = d.permissions.canModify && canCreate();
  const border = ins.status === 'Passed' ? 'var(--g)' : ins.status === 'Reinspection Required' ? '#d97706' : ins.status === 'Defect Confirmed' ? 'var(--r)' : 'var(--pri)';
  const reinsp = ins.status === 'Reinspection Required';
  const slOk = act && reinsp && last && !last.evaluated && !S.busy;
  const escOk = act && ins.status !== 'Passed' && !ins.reviewOpen && !S.busy;
  const ld = ins.lastDecision || {};
  const openRv = (d.reviews || []).find((r) => r.status === 'open');
  let hint = '';
  if (reinsp && last && last.evaluated) hint = act ? 'Upload a recapture below, then run Second Look.' : '';
  else if (reinsp && last && !last.evaluated) hint = 'A recapture is waiting. Run Second Look to evaluate it.';
  else if (!act && canCreate()) hint = 'Only the inspector who owns this inspection (or an administrator) can act on it.';
  else if (!canCreate()) hint = 'Reviewers decide through the Human Review queue.';
  return `<div class="card" style="border-width:2px;border-color:${border}"><h2>Agent decision</h2><div class="bdg ${SC[ins.status]}" style="font-size:15px;padding:5px 12px">${esc(ins.status.toUpperCase())}</div>
  <div class="row" style="margin:14px 0;gap:22px"><div><div class="k">${anomaly ? 'PatchCore anomaly score' : 'Confidence'}</div><div class="kv">${anomaly ? esc(anomaly.score) : last && last.defect.confidence != null ? Math.round(last.defect.confidence) + '%' : '—'}</div></div><div><div class="k">${anomaly ? 'Calibrated threshold' : 'Confidence threshold'}</div><div class="kv">${anomaly ? esc(anomaly.threshold) : T + '%'}</div></div><div><div class="k">Evidence quality</div><div class="kv" style="font-size:18px;padding-top:6px">${evb(last ? last.evidence.label : 'Unavailable')}</div></div></div>
  ${anomaly ? `<p class="k" style="margin:0 0 10px">${esc(anomaly.scoreSemantics)} Category: ${esc(last.modelCategory || '')}.</p>` : ''}
  ${last && last.assessmentError ? `<div class="er">${esc(last.assessmentError)} No automatic decision was made.</div>` : ''}
  ${last && last.source.demo ? `<div class="sim" style="margin-bottom:6px">${last.source.kind === 'seed' ? 'Sample data.' : 'Demo mode: the scores for this attempt are generated by a mock provider, not a real model.'}</div>` : ''}
  <p style="margin:0 0 12px">${esc(ld.reason || '')}</p>
  ${reinsp && ld.recommendations && ld.recommendations.length ? `<div class="k" style="margin-bottom:4px">Recommended actions</div><ol class="ac">${ld.recommendations.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>` : ''}
  ${ins.humanVerified && ins.humanVerified.at ? `<div class="k">Verified by a human reviewer on ${fdt(ins.humanVerified.at)}.</div>` : ''}
  <div class="row" style="margin-top:16px"><button class="btn pri" ${slOk ? '' : 'disabled'} onclick="sl()">${S.busy === 'sl' ? '<span class="spin"></span>Running…' : 'Run Second Look'}</button>
  <button class="btn" ${escOk ? '' : 'disabled'} onclick="S.m=true;S.formErr='';render()">Escalate to Human</button>
  ${canReview() && openRv ? `<button class="btn" onclick="openReviewFor('${esc(openRv.id)}')">Open review</button>` : ''}</div>
  ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}</div>`;
}

function fileBox(kind, label) {
  const b = S.fb[kind];
  return `<div class="dz" role="button" tabindex="0" onclick="$('#fi-${kind}').click()" onkeydown="if(event.key==='Enter'||event.key===' ')$('#fi-${kind}').click()" ondragover="event.preventDefault()" ondrop="event.preventDefault();setFile('${kind}',event.dataTransfer.files[0])">${ic('up', 28)}<div>${label}</div><div class="k">JPG, JPEG, PNG or WEBP, up to 5 MB</div></div>
  <input id="fi-${kind}" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden onchange="setFile('${kind}',this.files[0])">
  ${b.err ? `<p role="alert" class="er" style="margin-top:8px">${esc(b.err)}</p>` : ''}
  ${b.file ? `<img src="${b.url}" alt="Selected image preview" style="max-width:100%;max-height:220px;border-radius:8px;margin-top:12px"><div class="k">${esc(b.file.name)} · ${(b.file.size / 1024).toFixed(0)} KB</div>` : ''}
  ${b.prog != null ? `<div class="pb" role="progressbar" aria-valuenow="${b.prog}" aria-valuemin="0" aria-valuemax="100"><i id="pb-${kind}" style="width:${b.prog}%"></i></div><div class="k" id="pt-${kind}">${b.prog < 100 ? 'Uploading… ' + b.prog + '%' : 'Processing evidence…'}</div>` : ''}`;
}
function setFile(kind, f) {
  const b = S.fb[kind];
  if (b.url) URL.revokeObjectURL(b.url);
  S.fb[kind] = { file: null, url: '', err: '', prog: null };
  if (!f) return render();
  if (!/^image\/(jpe?g|png|webp)$/.test(f.type)) S.fb[kind].err = 'Unsupported file type. Use JPG, JPEG, PNG or WEBP.';
  else if (f.size > 5 * 1024 * 1024) S.fb[kind].err = 'File is larger than 5 MB. Choose a smaller image.';
  else if (f.size === 0) S.fb[kind].err = 'The file is empty.';
  else { S.fb[kind].file = f; S.fb[kind].url = URL.createObjectURL(f); }
  render();
}
function progress(kind) {
  return (p) => {
    S.fb[kind].prog = p;
    const el = $('#pb-' + kind); if (el) el.style.width = p + '%';
    const t = $('#pt-' + kind); if (t) t.textContent = p < 100 ? 'Uploading… ' + p + '%' : 'Processing evidence…';
  };
}

function recapturePanel(d) {
  const ins = d.inspection, last = d.attempts[d.attempts.length - 1];
  if (!(d.permissions.canModify && canCreate() && ins.status === 'Reinspection Required' && last && last.evaluated)) return '';
  const b = S.fb.rc;
  return `<div class="card" style="margin-top:14px"><h2>Upload a recapture (attempt ${ins.attemptCount + 1})</h2>
  <p class="k" style="margin:0 0 10px">The previous evidence and its assessment are kept. The new image is stored as a separate attempt.</p>
  ${fileBox('rc', 'Drag a new image here or choose a file')}
  <button class="btn pri" style="margin-top:12px" ${!b.file || S.busy ? 'disabled' : ''} onclick="submitRecapture()">${S.busy === 'rc' ? '<span class="spin"></span>Uploading…' : 'Upload recapture'}</button></div>`;
}

function attemptsCard(d) {
  const at = d.attempts;
  return `<div class="card"><h2>Inspection attempts</h2><div class="tw"><table><thead><tr><th>#</th><th>When</th><th>Score</th>${QN.map(([, l]) => `<th>${l.slice(0, 5)}.</th>`).join('')}<th>Evidence</th><th>Source</th><th>Outcome</th></tr></thead><tbody>${at.map((a, i) => {
    const p = i ? at[i - 1] : null;
    const score = a.anomaly && a.anomaly.score != null ? String(a.anomaly.score) : pv(a.defect.confidence);
    const scoreDelta = p && a.anomaly && p.anomaly && p.anomaly.score != null ? delta(a.anomaly.score, p.anomaly.score) : p && !a.anomaly && !p.anomaly ? delta(a.defect.confidence, p.defect.confidence) : '';
    return `<tr><td>${a.number}</td><td>${fdt(a.createdAt)}</td><td>${score}${scoreDelta}</td>${QN.map(([k]) => `<td>${a.quality[k] == null ? '—' : Math.round(a.quality[k]) + '%'}${p ? delta(a.quality[k], p.quality[k]) : ''}</td>`).join('')}<td>${evb(a.evidence.label)}</td><td>${srcLabel(a)}</td><td>${a.outcome ? bdg(a.outcome) : '<span class="k">Awaiting Second Look</span>'}</td></tr>`;
  }).join('')}</tbody></table></div><p class="k" style="margin:8px 0 0">▲▼ show the change from the previous attempt. “—” means the measurement was not calculated. Current status: ${bdg(d.inspection.status)}</p></div>`;
}
function timeline(audit) {
  return `<ul class="tl">${audit.slice().reverse().map((h) => {
    let t = ACT[h.action] || h.action;
    if (h.attemptNumber && /uploaded|assess/.test(h.action)) t += ` (attempt ${h.attemptNumber})`;
    if ((h.action === 'decision' || h.action === 'second_look' || h.action === 'review_decision' || h.action === 'escalated') && h.to) t += `: ${h.to}`;
    return `<li><small>${fdt(h.createdAt)}</small>${esc(t)}<small style="margin-left:6px">· ${esc(h.actorName || 'System')}</small>${h.reason ? `<span class="sub">${esc(h.rule ? h.rule + ': ' : '')}${esc(h.reason)}</span>` : ''}</li>`;
  }).join('')}</ul>`;
}
const details = (d) => `<div class="ga" style="margin-top:14px;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)">${attemptsCard(d)}<div class="card"><h2>Activity timeline</h2>${timeline(d.audit)}</div></div>`;

function pager(meta, fn) {
  if (!meta) return '';
  if (meta.pages <= 1) return `<div class="pgn"><span class="k">${meta.total} total</span></div>`;
  return `<div class="pgn"><span class="k">Page ${meta.page} of ${meta.pages} · ${meta.total} total</span><span class="sp"></span><button class="btn sm" ${meta.page <= 1 ? 'disabled' : ''} onclick="${fn}(${meta.page - 1})">Previous</button><button class="btn sm" ${meta.page >= meta.pages ? 'disabled' : ''} onclick="${fn}(${meta.page + 1})">Next</button></div>`;
}
const fsel = () => `<select class="f" aria-label="Filter by status" onchange="setFilter(this.value)"><option>All</option>${ST.map((s) => `<option ${S.f === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
function qcard() {
  const arrow = (f) => (S.sort === f ? (S.order === 'asc' ? ' ▲' : ' ▼') : '');
  const th = (f, l) => `<th class="so" onclick="sortBy('${f}')" aria-sort="${S.sort === f ? (S.order === 'asc' ? 'ascending' : 'descending') : 'none'}">${l}${arrow(f)}</th>`;
  let rows;
  if (!S.list) rows = `<tr><td colspan="8" class="empty"><span class="spin"></span>Loading inspections…</td></tr>`;
  else if (!S.list.items.length) rows = `<tr><td colspan="8" class="empty">${S.q || S.f !== 'All' ? 'No inspections match. Clear the search or change the status filter.' : 'No inspections yet. Create one with “New Inspection”.'}</td></tr>`;
  else rows = S.list.items.map((r) => { const latest = r.latest || {}; const score = latest.anomaly && latest.anomaly.score != null ? String(latest.anomaly.score) : latest.confidence != null ? Math.round(latest.confidence) + '%' : '—'; return `<tr class="${r.code === S.sel ? 'sel' : ''}"><td><b>${esc(r.code)}</b></td><td>${esc(r.componentName)}</td><td>${score}</td><td>${evb(latest.evidenceLabel)}</td><td>${bdg(r.status)}</td><td>${r.attemptCount}</td><td>${fdt(r.updatedAt)}</td><td><button class="btn sm" onclick="pick('${esc(r.code)}')">View</button></td></tr>`; }).join('');
  return `<div class="card"><div class="row"><h2 style="margin:0">Inspection queue</h2><span class="sp"></span>${fsel()}</div><div class="tw"><table><thead><tr>${th('code', 'ID')}${th('componentName', 'Component')}${th('confidence', 'Score')}<th>Evidence quality</th>${th('status', 'Status')}<th>Attempts</th>${th('updatedAt', 'Updated')}<th></th></tr></thead><tbody>${rows}</tbody></table></div>${pager(S.list && S.list.meta, 'pgQueue')}</div>`;
}

// ---------------------------------------------------------------------------------------------------- views
const V = {
  ov() {
    const d = S.dash;
    const m = d ? [['Total Inspections', d.total], ['Reinspection Required', d.reinspectionRequired], ['Awaiting Human Review', d.awaitingHumanReview], ['Defect Confirmed', d.defectConfirmed], ['Passed', d.passed]] : [];
    const cards = d ? `<div class="g5">${m.map((x) => `<div class="card"><div class="k">${x[0]}</div><div class="kv">${x[1]}</div></div>`).join('')}</div>` : `<div class="empty"><span class="spin"></span>Loading…</div>`;
    let main = '';
    if (S.detail) {
      const dt = S.detail, last = dt.attempts[dt.attempts.length - 1];
      main = `${stepper(dt.inspection, last)}<div class="g2">${imgPanel({ code: dt.inspection.code, name: dt.inspection.componentName, type: dt.inspection.inspectionType, attempts: dt.attempts })}<div>${decideCard(dt)}${recapturePanel(dt)}</div></div>`;
    } else if (S.detailLoading) main = `<div class="empty"><span class="spin"></span>Loading inspection…</div>`;
    else if (S.list && !S.list.items.length && S.f === 'All' && !S.q) main = `<div class="card empty"><h2>No inspections yet</h2><p>Upload evidence for a component to start the first inspection.</p>${canCreate() ? `<button class="btn pri" onclick="go('new')">New Inspection</button>` : ''}</div>`;
    return `${cards}<p class="k" style="margin:-4px 0 12px">Live from the database. Counts update as inspections change.</p>${main}<div style="margin-top:14px">${qcard()}</div>${S.detail ? details(S.detail) : ''}`;
  },
  new() {
    if (!canCreate()) return `<div class="card empty">Your role (${esc(role())}) cannot create inspections. Use the Human Review queue instead.</div>`;
    const b = S.fb.new, demo = S.cfg && S.cfg.provider.demo;
    const categoryOptions = `<option value="">Choose a category</option>${S.categories.map((c) => `<option value="${esc(c.category)}" ${S.modelCategory === c.category ? 'selected' : ''}>${esc(c.category)}${c.ready ? ' · model ready' : ' · quality-only'}</option>`).join('')}`;
    const selectedCategory = S.categories.find((c) => c.category === S.modelCategory);
    const categoryHint = demo
      ? 'Demo mode: model category is recorded as requested metadata; mock scores are not trained for this category.'
      : selectedCategory && !selectedCategory.ready
        ? 'No trained, validated model is configured. This upload will produce image-quality measurements only and go to human review.'
        : selectedCategory
          ? 'Category readiness comes from the configured model registry. Verify its dataset and validation scope before operational use.'
          : 'Categories come from the VisA dataset. This selection is separate from inspection workflow type.';
    return `<div class="card" style="max-width:640px"><h2>New inspection</h2>
    ${demo ? '<div class="bdg a" style="margin-bottom:12px;white-space:normal">Demo mode: scores come from a built-in mock provider, not a real AI model. See docs/MODEL_INTEGRATION.md to connect one.</div>' : ''}
    <div class="fld"><label class="k" for="mc">Anomaly model category</label><select id="mc" onchange="S.modelCategory=this.value">${S.categories.length ? categoryOptions : '<option value="">Loading model categories…</option>'}</select><p class="hint">${esc(categoryHint)}</p></div>
    ${fileBox('new', 'Drag an image here or choose a file')}
    ${S.formErr ? `<div class="er" role="alert" style="margin-top:12px">${esc(S.formErr)}${S.formDetails.length ? `<ul>${S.formDetails.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : ''}
    <div class="fld"><label class="k" for="cn">Component name</label><input id="cn" type="text" value="${esc(S.name)}" maxlength="120" placeholder="e.g. Pump Casing P88" oninput="S.name=this.value"></div>
    <div class="fld"><label class="k" for="ct">Inspection type</label><select id="ct" onchange="S.type=this.value">${TYPES.map((t) => `<option ${S.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="fld"><label class="k" for="nt">Notes (optional)</label><textarea id="nt" rows="3" maxlength="2000" oninput="S.notes=this.value">${esc(S.notes)}</textarea></div>
    <button class="btn pri" style="margin-top:16px" ${S.busy ? 'disabled' : ''} onclick="startI()">${S.busy === 'new' ? '<span class="spin"></span>Uploading…' : 'Start Inspection'}</button></div>`;
  },
  queue() { return qcard(); },
  hist() {
    let rows;
    if (!S.hist) rows = `<tr><td colspan="9" class="empty"><span class="spin"></span>Loading…</td></tr>`;
    else if (!S.hist.items.length) rows = `<tr><td colspan="9" class="empty">No evidence records match.</td></tr>`;
    else rows = S.hist.items.map((a) => `<tr><td><b>${esc(a.inspection.code)}</b></td><td>${esc(a.inspection.componentName)}</td><td>${a.number}</td><td>${fdt(a.createdAt)}</td><td>${a.anomaly && a.anomaly.score != null ? esc(a.anomaly.score) : pv(a.defect.confidence)}</td><td>${QN.map(([k]) => (a.quality[k] == null ? '—' : Math.round(a.quality[k]))).join(' / ')}</td><td>${srcLabel(a)}</td><td>${a.outcome ? bdg(a.outcome) : '<span class="k">Awaiting Second Look</span>'}</td><td><button class="btn sm" onclick="pick('${esc(a.inspection.code)}')">View</button></td></tr>`).join('');
    return `<div class="card"><div class="row"><h2 style="margin:0">Evidence history</h2><span class="sp"></span>${fsel()}</div><div class="tw"><table><thead><tr><th>ID</th><th>Component</th><th>Attempt</th><th>Captured</th><th>Score</th><th>Sharp / Light / Align / Vis</th><th>Source</th><th>Outcome</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${pager(S.hist && S.hist.meta, 'pgHist')}</div>`;
  },
  review() {
    if (!canReview()) return `<div class="card empty">Only reviewers and administrators can use the review queue.</div>`;
    if (S.rvSel) return reviewDetail();
    let rows;
    if (!S.rv) rows = `<tr><td colspan="8" class="empty"><span class="spin"></span>Loading…</td></tr>`;
    else if (!S.rv.items.length) rows = `<tr><td colspan="8" class="empty">${S.rvTab === 'open' ? 'No reviews are waiting. Nice work.' : 'No decided reviews yet.'}</td></tr>`;
    else rows = S.rv.items.map((r) => `<tr><td><b>${esc(r.inspection ? r.inspection.code : '—')}</b></td><td>${esc(r.inspection ? r.inspection.componentName : '')}</td><td>${r.type === 'defect_signoff' ? 'Defect sign-off' : 'Escalation'}</td><td style="white-space:normal;min-width:220px">${esc((r.reason || '').slice(0, 110))}${(r.reason || '').length > 110 ? '…' : ''}</td><td>${fdt(r.createdAt)}</td><td>${r.level === 'admin' ? '<span class="bdg r">Admin</span>' : 'Reviewer'}</td><td>${r.status === 'decided' ? `${esc(RD[r.decision.action])}<div class="k">${esc(r.decision.reviewer ? r.decision.reviewer.name : '')}</div>` : 'Open'}</td><td><button class="btn sm" onclick="loadReviewDetail('${esc(r.id)}')">${r.status === 'open' ? 'Review' : 'View'}</button></td></tr>`).join('');
    return `<div class="card"><div class="row"><h2 style="margin:0">Human review queue</h2><span class="sp"></span><div class="tabs"><button class="btn sm ${S.rvTab === 'open' ? 'on' : ''}" onclick="S.rvTab='open';S.rvPage=1;loadReviews()">Open</button><button class="btn sm ${S.rvTab === 'decided' ? 'on' : ''}" onclick="S.rvTab='decided';S.rvPage=1;loadReviews()">Decided</button></div></div><div class="tw"><table><thead><tr><th>ID</th><th>Component</th><th>Type</th><th>Why</th><th>Opened</th><th>Level</th><th>Decision</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${pager(S.rv && S.rv.meta, 'pgRev')}</div>`;
  },
  an() {
    const a = S.an;
    const filter = `<div class="card" style="margin-bottom:14px"><div class="row"><div style="min-width:150px"><label class="k" for="af">From</label><input id="af" type="date" value="${esc(S.anFrom)}" onchange="S.anFrom=this.value"></div><div style="min-width:150px"><label class="k" for="at2">To</label><input id="at2" type="date" value="${esc(S.anTo)}" onchange="S.anTo=this.value"></div>
    <button class="btn pri" style="align-self:flex-end" onclick="loadAn()">Apply</button><span class="sp"></span><button class="btn sm" onclick="quickRange(7)">Last 7 days</button><button class="btn sm" onclick="quickRange(30)">Last 30 days</button><button class="btn sm" onclick="quickRange(0)">All time</button></div></div>`;
    if (!a) return filter + `<div class="empty"><span class="spin"></span>Loading analytics…</div>`;
    const hb = (rows, mx) => rows.map((x) => `<div style="margin:8px 0"><div class="row k"><span>${x[0]}</span><span class="sp"></span><b style="color:var(--tx)">${x[1]}</b></div><div class="bar"><i style="width:${mx ? (x[1] / mx) * 100 : 0}%;background:${x[2] || 'var(--pri)'}"></i></div></div>`).join('');
    const cl = (rows) => { const mx = Math.max(1, ...rows.map((x) => x[1])); return `<div class="col">${rows.map((x) => `<div><i style="height:${(x[1] / mx) * 80}px"></i>${x[0]}<br><b style="color:var(--tx)">${x[1]}</b></div>`).join('')}</div>`; };
    const t = a.totals, r = a.rates, e = a.evidenceIssues, w = a.reviewWorkload;
    const vmx = Math.max(1, ...a.volumeByDay.map((x) => x.count));
    const kpi = (l, v, sub) => `<div class="card"><div class="k">${l}</div><div class="kv">${v}</div><div class="k">${sub}</div></div>`;
    const em = Math.max(1, ...Object.values(e.counts));
    return `${filter}<div class="g4">${kpi('Inspections', t.total, 'in the selected period')}${kpi('Pass rate', r.passRate == null ? '—' : r.passRate + '%', 'of finalised decisions')}${kpi('Defect confirmation', r.defectConfirmationRate == null ? '—' : r.defectConfirmationRate + '%', 'of finalised decisions')}${kpi('Reinspection rate', r.reinspectionRate == null ? '—' : r.reinspectionRate + '%', r.inspectionsWithRecapture + ' needed a recapture')}</div>
    <div class="ga"><div class="card"><h2>Inspection outcomes</h2><div class="k">Live from stored records</div>${hb([['Passed', t.passed, '#16a34a'], ['Defect Confirmed', t.defectConfirmed, '#dc2626'], ['Reinspection Required', t.reinspectionRequired, '#d97706'], ['Awaiting Human Review', t.awaitingHumanReview, '#4f46e5']], Math.max(1, t.total))}</div>
    <div class="card"><h2>Common evidence-quality issues</h2><div class="k">Attempts scoring below ${e.minQualityScore}% · ${e.attemptsAssessed} assessed${e.failedAssessments ? ' · ' + e.failedAssessments + ' failed assessments' : ''}</div>${hb([['Low sharpness', e.counts.sharpness], ['Uneven lighting', e.counts.lighting], ['Misalignment', e.counts.alignment], ['Poor visibility', e.counts.visibility]], em)}</div>
    <div class="card"><h2>Inspection volume per day</h2><div class="k" style="margin-bottom:8px">New inspections created</div>${a.volumeByDay.length ? `<div class="vol">${a.volumeByDay.map((x) => `<i class="${x.count ? '' : 'z'}" style="height:${x.count ? Math.max(4, (x.count / vmx) * 100) : 2}%" title="${x.date}: ${x.count}"></i>`).join('')}</div><div class="ax"><span>${a.volumeByDay[0].date}</span><span>peak ${vmx} / day</span><span>${a.volumeByDay[a.volumeByDay.length - 1].date}</span></div>` : '<div class="empty">No data</div>'}</div>
    <div class="card"><h2>Recaptures per week</h2><div class="k" style="margin-bottom:8px">Weeks start on Monday (UTC)</div>${cl(a.recapturesByWeek.map((x) => [x.weekStart.slice(5), x.count]))}</div>
    <div class="card"><h2>Review workload</h2><div class="row" style="gap:22px;margin:6px 0 10px"><div><div class="k">Open now</div><div class="kv">${w.open}</div></div><div><div class="k">Decided</div><div class="kv">${w.decidedInRange}</div></div><div><div class="k">Avg. time to decide</div><div class="kv" style="font-size:20px;padding-top:4px">${w.avgDecisionHours == null ? '—' : w.avgDecisionHours + ' h'}</div></div></div>
    ${Object.keys(w.byDecision).length ? hb(Object.entries(w.byDecision).map(([k, v]) => [RD[k] || k, v]), Math.max(...Object.values(w.byDecision))) : '<div class="k">No review decisions in this period.</div>'}
    ${w.byReviewer.length ? `<div class="k" style="margin-top:10px">By reviewer</div>${w.byReviewer.map((x) => `<div class="row k" style="margin:4px 0"><span>${esc(x.name)}</span><span class="sp"></span><b style="color:var(--tx)">${x.decided}</b></div>`).join('')}` : ''}</div></div>`;
  },
  set() {
    if (!S.set) return `<div class="empty"><span class="spin"></span>Loading settings…</div>`;
    const f = S.setForm, adm = isAdmin(), dis = adm ? '' : 'disabled';
    const num = (k, l, min, max, help) => `<div class="fld"><label class="k" for="s-${k}">${l}: <b id="v-${k}" style="color:var(--tx)">${f[k]}%</b></label><input id="s-${k}" type="range" min="${min}" max="${max}" value="${f[k]}" ${dis} style="width:100%" oninput="S.setForm.${k}=+this.value;$('#v-${k}').textContent=this.value+'%'"><p class="k" style="margin:2px 0 0">${help}</p></div>`;
    const pr = S.set.provider;
    return `<div class="ga" style="align-items:start"><div class="card"><h2>Inspection rules</h2>
    ${adm ? '' : '<p class="hint" style="margin:0 0 8px">Only administrators can change these. You can see the values currently in force.</p>'}
    ${num('confidenceThreshold', 'Confidence threshold', 50, 99, 'Below this model confidence, a case goes to a human reviewer.')}
    ${num('minQualityScore', 'Minimum quality score', 20, 95, 'If any of sharpness, lighting, alignment or visibility is below this, evidence is insufficient and a recapture is required.')}
    ${num('adequateQualityScore', 'Adequate quality (average)', 30, 99, 'A “Passed” decision needs average quality at or above this.')}
    <div class="fld"><label class="k" for="s-ma">Maximum attempts: <b id="v-maxAttempts" style="color:var(--tx)">${f.maxAttempts}</b></label><input id="s-ma" type="range" min="1" max="10" value="${f.maxAttempts}" ${dis} style="width:100%" oninput="S.setForm.maxAttempts=+this.value;$('#v-maxAttempts').textContent=this.value"><p class="k" style="margin:2px 0 0">After this many insufficient attempts the case goes to a human instead of looping.</p></div>
    <div class="fld"><label class="row k"><input type="checkbox" ${f.requireDefectSignoff ? 'checked' : ''} ${dis} onchange="S.setForm.requireDefectSignoff=this.checked"> Confirmed defects require human sign-off</label></div>
    ${adm ? `<div class="row" style="margin-top:16px"><button class="btn pri" ${S.busy ? 'disabled' : ''} onclick="saveRules()">${S.busy === 'rules' ? '<span class="spin"></span>Saving…' : 'Save rules'}</button><button class="btn" onclick="S.setForm={...S.set.defaults};render()">Restore defaults</button></div>` : ''}
    ${S.formErr ? `<div class="er" style="margin-top:10px">${esc(S.formErr)}</div>` : ''}
    <p class="k" style="margin-top:12px">Rule changes apply to new decisions. Earlier attempts keep the thresholds that were in force when they were evaluated.</p></div>
    <div><div class="card"><h2>My account</h2><div class="fld" style="margin-top:0"><label class="k" for="sn">Name</label><input id="sn" type="text" value="${esc(S.user.name)}" maxlength="80"></div><div class="k" style="margin-top:8px">${esc(S.user.email)} · ${esc(cap(S.user.role))}</div>
    <div class="fld"><label class="k" for="st">Theme</label><select id="st">${['system', 'light', 'dark'].map((t) => `<option value="${t}" ${(S.user.preferences && S.user.preferences.theme) === t ? 'selected' : ''}>${cap(t)}</option>`).join('')}</select></div>
    <button class="btn pri" style="margin-top:14px" ${S.busy ? 'disabled' : ''} onclick="saveMe()">Save</button></div>
    <div class="card" style="margin-top:14px"><h2>Inspection provider</h2><div class="row"><b>${esc(pr.provider)}</b>${pr.demo ? '<span class="bdg a">Demo mode</span>' : '<span class="bdg b">Configured provider</span>'}</div>
    <p class="k" style="margin:8px 0 0">${pr.demo ? 'Scores are generated by a mock provider from the image bytes. They are not real defect predictions. See docs/MODEL_INTEGRATION.md to connect a real model.' : 'The configured service response is validated before storage. Check each result’s declared capabilities: an OpenCV quality-only result does not include defect inference.'}</p></div></div></div>
    ${adm && S.users ? `<div class="card" style="margin-top:14px"><h2>Users</h2><div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Last sign-in</th></tr></thead><tbody>${S.users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><select class="f" aria-label="Role for ${esc(u.name)}" ${u.id === S.user.id ? 'disabled' : ''} onchange="updateUser('${esc(u.id)}',{role:this.value})">${['admin', 'inspector', 'reviewer'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td><input type="checkbox" ${u.active ? 'checked' : ''} ${u.id === S.user.id ? 'disabled' : ''} aria-label="Active" onchange="updateUser('${esc(u.id)}',{active:this.checked})"></td><td>${fdt(u.lastLoginAt)}</td></tr>`).join('')}</tbody></table></div><p class="k" style="margin:8px 0 0">Changing a role or disabling an account signs that user out immediately.</p></div>` : ''}`;
  },
};

function reviewDetail() {
  const d = S.rvDetail;
  const back = `<button class="btn sm" style="margin-bottom:12px" onclick="S.rvSel=null;S.rvDetail=null;S.at=null;loadReviews()">← Back to queue</button>`;
  if (!d) return back + `<div class="empty"><span class="spin"></span>Loading review…</div>`;
  const r = d.review, ins = r.inspection;
  const open = r.status === 'open', mine = open && (r.level === 'reviewer' || isAdmin());
  const f = S.rf, needVerdict = f.decision === 'approve' && r.type === 'escalation';
  const form = mine ? `<div class="card" style="margin-top:14px"><h2>Your decision</h2>${S.formErr ? `<div class="er" role="alert">${esc(S.formErr)}</div>` : ''}
    <div class="fr"><div><label class="k" for="rd">Action</label><select id="rd" onchange="S.rf.decision=this.value;S.rf.verdict='';render()">${['approve', 'reject', 'request_recapture'].concat(r.level === 'reviewer' ? ['escalate'] : []).map((x) => `<option value="${x}" ${f.decision === x ? 'selected' : ''}>${RD[x]}</option>`).join('')}</select></div>
    ${needVerdict ? `<div><label class="k" for="rvd">Final verdict</label><select id="rvd" onchange="S.rf.verdict=this.value"><option value="">Choose…</option><option value="pass" ${f.verdict === 'pass' ? 'selected' : ''}>Pass: no defect</option><option value="defect" ${f.verdict === 'defect' ? 'selected' : ''}>Defect confirmed</option></select></div>` : '<div></div>'}</div>
    <div class="fld"><label class="k" for="rc">Comment${f.decision === 'approve' ? ' (optional)' : ' (required)'}</label><textarea id="rc" rows="3" maxlength="1000" oninput="S.rf.comment=this.value">${esc(f.comment)}</textarea></div>
    <p class="hint">${f.decision === 'approve' ? (r.type === 'defect_signoff' ? 'Approving signs off the confirmed defect.' : 'Approving records your final verdict.') : f.decision === 'escalate' ? 'Hands this review to an administrator.' : 'Sends the inspection back for a new recapture.'}</p>
    <button class="btn pri" style="margin-top:12px" ${S.busy ? 'disabled' : ''} onclick="submitReview()">${S.busy === 'rv' ? '<span class="spin"></span>Saving…' : 'Submit decision'}</button></div>`
    : `<div class="card" style="margin-top:14px"><h2>${open ? 'Waiting for an administrator' : 'Decision'}</h2>${r.status === 'decided' ? `<p style="margin:0"><b>${esc(RD[r.decision.action])}</b>${r.decision.verdict ? ' · verdict: ' + esc(r.decision.verdict) : ''} · ${esc(r.decision.reviewer ? r.decision.reviewer.name : '')} · ${fdt(r.decision.decidedAt)}</p>${r.decision.comment ? `<p class="k">“${esc(r.decision.comment)}”</p>` : ''}<p class="k">Resulting status: ${bdg(r.decision.resultingStatus)}</p>` : '<p class="k" style="margin:0">This review was escalated and only an administrator can decide it.</p>'}</div>`;
  return `${back}<div class="card" style="margin-bottom:14px"><div class="row"><div><b>${esc(ins.code)}</b> · ${esc(ins.componentName)}<div class="k">${esc(ins.inspectionType)} · ${r.type === 'defect_signoff' ? 'Defect sign-off' : 'Escalation'} · opened ${fdt(r.createdAt)}${r.requestedBy ? ' by ' + esc(r.requestedBy.name) : ' automatically'}</div></div><span class="sp"></span>${bdg(ins.status)}</div><p style="margin:10px 0 0">${esc(r.reason)}</p></div>
  <div class="g2">${imgPanel({ code: ins.code, name: ins.componentName, type: ins.inspectionType, attempts: d.attempts })}<div>${form}</div></div>${details({ inspection: ins, attempts: d.attempts, audit: d.audit })}`;
}

// ---------------------------------------------------------------------------------------------------- shell
function shell() {
  const aw = S.dash ? S.dash.awaitingHumanReview : 0;
  const nav = [['ov', 'grid']];
  if (canCreate()) nav.push(['new', 'plus']);
  nav.push(['queue', 'list'], ['hist', 'clock']);
  if (canReview()) nav.push(['review', 'rv']);
  nav.push(['an', 'bars'], ['set', 'sl']);
  const demo = S.cfg && S.cfg.provider.demo;
  return `<div class="sc ${S.nav ? 'open' : ''}" onclick="S.nav=false;render()"></div><aside class="side ${S.nav ? 'open' : ''}" aria-label="Main navigation"><div class="logo"><i>${ic('se', 16)}</i>SecondLook</div><nav>${nav.map((n) => `<button class="nv ${S.v === n[0] ? 'on' : ''}" onclick="go('${n[0]}')" ${S.v === n[0] ? 'aria-current="page"' : ''}>${ic(n[1])}${P[n[0]]}</button>`).join('')}</nav>
  <div class="agent"><div class="who"><b>${esc(S.user.name)}</b>${esc(cap(S.user.role))}</div><div><span class="dot"></span>${demo ? 'Demo mode · mock AI scores' : 'Model service connected'}</div><button class="sbtn" onclick="signOut()">Sign out</button></div></aside>
  <div class="main"><header class="top"><button class="ib menu" aria-label="Open menu" onclick="S.nav=true;render()">${ic('mn')}</button><h1>${P[S.v]}</h1>${['ov', 'queue', 'hist'].includes(S.v) ? `<label class="srch">${ic('se', 15)}<input id="gs" type="text" aria-label="Search inspections" placeholder="Search ID or component" value="${esc(S.q)}" oninput="onSearch(this.value)"></label>` : ''}<button class="ib" aria-label="${aw} awaiting review" onclick="bell()">${ic('bell')}${aw ? `<b>${aw}</b>` : ''}</button><div class="av" aria-label="${esc(S.user.name)}">${esc(initials(S.user.name))}</div></header>
  ${S.net ? `<div class="bnr" role="alert"><span>${esc(S.net)}</span><span class="sp"></span><button class="btn sm" onclick="S.net='';go(S.v,true)">Retry</button></div>` : ''}
  <main class="pg">${V[S.v]()}</main></div>${S.m ? modal() : ''}${S.toast ? `<div class="toast ${S.toast.err ? 'err' : ''}" role="status">${esc(S.toast.t)}</div>` : ''}`;
}
function bell() { if (canReview()) go('review'); else { S.f = ST[1]; S.page = 1; go('queue', true); } }
function modal() {
  return `<div class="mo" onclick="if(event.target===this){S.m=false;render()}"><div class="md" role="dialog" aria-modal="true" aria-label="Escalate to human"><h2 style="margin:0 0 4px">Escalate ${esc(S.sel)} to human review</h2><p class="k" style="margin:0 0 12px">The reviewer will see the full evidence history.</p>${S.formErr ? `<div class="er">${esc(S.formErr)}</div>` : ''}<label class="k" for="er">Reason</label><select id="er">${['Low confidence after recapture', 'Evidence still insufficient', 'Defect requires sign-off', 'Other'].map((t) => `<option>${t}</option>`).join('')}</select><label class="k" for="en" style="display:block;margin-top:10px">Reviewer note (optional)</label><textarea id="en" rows="3" maxlength="1000"></textarea><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="S.m=false;render()">Cancel</button><button class="btn pri" ${S.busy ? 'disabled' : ''} onclick="confirmEscalate()">${S.busy === 'esc' ? '<span class="spin"></span>Escalating…' : 'Confirm Escalation'}</button></div></div></div>`;
}
function render() {
  const ae = document.activeElement, id = ae && ae.id, ss = ae && ae.selectionStart, se = ae && ae.selectionEnd, sy = scrollY;
  $('#app').innerHTML = S.user ? shell() : authView();
  if (id) { const el = document.getElementById(id); if (el && el !== document.activeElement) { el.focus(); try { if (ss != null) el.setSelectionRange(ss, se); } catch (_) {} } }
  if (Math.abs(scrollY - sy) > 1) scrollTo(0, sy);
}

// ---------------------------------------------------------------------------------------------------- actions
async function sl() {
  if (S.busy) return;
  S.busy = 'sl'; render();
  const r = await run(() => API.post(`/inspections/${encodeURIComponent(S.sel)}/decision`, { action: 'second_look' }));
  S.busy = false;
  if (r) toast('Second Look complete: ' + r.data.outcome.status);
  await refreshAll();
}
async function confirmEscalate() {
  if (S.busy) return;
  S.busy = 'esc'; S.formErr = ''; render();
  try {
    await API.post(`/inspections/${encodeURIComponent(S.sel)}/decision`, { action: 'escalate', reason: $('#er').value, note: $('#en').value.trim() });
    S.m = false; S.busy = false; toast('Escalated. Awaiting human review.');
  } catch (e) { S.busy = false; if (e.status === 409 || e.status === 404) { S.m = false; handleErr(e); } else S.formErr = e.message; }
  await refreshAll();
}
async function startI() {
  if (S.busy) return;
  const b = S.fb.new; S.formErr = ''; S.formDetails = [];
  if (!b.file) { S.formErr = 'Choose an image first.'; return render(); }
  if (S.name.trim().length < 2) { S.formErr = 'Enter a component name (at least 2 characters).'; return render(); }
  const fd = new FormData();
  fd.append('componentName', S.name.trim()); fd.append('inspectionType', S.type); if (S.modelCategory) fd.append('modelCategory', S.modelCategory); if (S.notes.trim()) fd.append('notes', S.notes.trim());
  fd.append('image', b.file);
  S.busy = 'new'; b.prog = 0; render();
  try {
    const r = await API.upload('/inspections', fd, progress('new'));
    const { inspection, outcome } = r.data;
    if (b.url) URL.revokeObjectURL(b.url);
    S.fb.new = {}; S.name = ''; S.notes = ''; S.type = TYPES[0]; S.modelCategory = ''; S.busy = false; S.sel = inspection.code; S.at = null;
    toast(`${inspection.code} created: ${outcome.status}`);
    go('ov', true);
  } catch (e) { S.busy = false; b.prog = null; if (e.code !== 'SESSION_EXPIRED') { S.formErr = e.message; S.formDetails = detailsList(e); } render(); }
}
async function submitRecapture() {
  const b = S.fb.rc;
  if (S.busy || !b.file) return;
  const fd = new FormData(); fd.append('image', b.file);
  S.busy = 'rc'; b.prog = 0; render();
  try {
    const r = await API.upload(`/inspections/${encodeURIComponent(S.sel)}/recapture`, fd, progress('rc'));
    if (b.url) URL.revokeObjectURL(b.url);
    S.fb.rc = {}; S.busy = false; S.at = null;
    toast(`Recapture uploaded (attempt ${r.data.attempt.number}). Run Second Look to evaluate it.`);
  } catch (e) { S.busy = false; b.prog = null; b.err = e.message; if (e.status === 409) await refreshAll(); }
  await refreshAll();
}
function openReviewFor(id) { S.v = 'review'; S.rvSel = id; render(); loadReviewDetail(id); }
async function submitReview() {
  if (S.busy) return;
  const f = S.rf, r = S.rvDetail.review;
  S.formErr = '';
  if (f.decision !== 'approve' && f.comment.trim().length < 3) { S.formErr = 'A comment of at least 3 characters is required for this action.'; return render(); }
  if (f.decision === 'approve' && r.type === 'escalation' && !f.verdict) { S.formErr = 'Choose a final verdict (pass or defect) before approving.'; return render(); }
  S.busy = 'rv'; render();
  const body = { decision: f.decision, comment: f.comment.trim() };
  if (f.decision === 'approve' && r.type === 'escalation') body.verdict = f.verdict;
  try {
    await API.post(`/reviews/${S.rvSel}/decision`, body);
    S.busy = false; toast('Decision saved.'); S.rvSel = null; S.rvDetail = null; loadDash(); loadReviews();
  } catch (e) { S.busy = false; S.formErr = e.message; render(); if (e.status === 409) loadReviewDetail(S.rvSel); }
}
async function saveRules() {
  if (S.busy) return;
  S.busy = 'rules'; S.formErr = ''; render();
  const f = S.setForm;
  try {
    const r = await API.put('/settings/app', { confidenceThreshold: f.confidenceThreshold, minQualityScore: f.minQualityScore, adequateQualityScore: f.adequateQualityScore, maxAttempts: f.maxAttempts, requireDefectSignoff: !!f.requireDefectSignoff });
    S.set.app = r.data.app; S.cfg.app = r.data.app; S.setForm = { ...r.data.app }; toast('Rules saved. They apply to new decisions.');
  } catch (e) { S.formErr = e.message + (detailsList(e).length ? ' ' + detailsList(e).join('; ') : ''); }
  S.busy = false; render();
}
async function saveMe() {
  if (S.busy) return;
  const name = $('#sn').value.trim(), theme = $('#st').value;
  S.busy = 'me'; render();
  const r = await run(() => API.patch('/settings/me', { name, preferences: { theme } }));
  S.busy = false;
  if (r) { S.user = r.data.me; applyTheme(theme); toast('Saved.'); } else render();
}
async function updateUser(id, patch) {
  const r = await run(() => API.patch('/users/' + id, patch));
  if (r) toast('User updated.');
  const u = await run(() => API.get('/users?limit=100')); if (u) S.users = u.data;
  render();
}
function quickRange(days) {
  const iso = (d) => d.toISOString().slice(0, 10), t = new Date();
  S.anTo = days ? iso(t) : ''; S.anFrom = days ? iso(new Date(t.getTime() - (days - 1) * 86400000)) : '';
  loadAn();
}
document.onkeydown = (e) => { if (e.key === 'Escape' && S.m) { S.m = false; render(); } };

// ---------------------------------------------------------------------------------------------------- boot
(async function boot() {
  if (location.protocol === 'file:') {
    S.authErr = 'This page cannot talk to the server when opened as a file. Start the backend and open http://localhost:5000 instead (see README).';
    return render();
  }
  S.booting = !!API.store.get(); render();
  if (S.booting) {
    try { const r = await API.me(); S.user = r.data.user; await afterLogin(); }
    catch (e) { if (e.status === 401) API.store.set(''); else S.authErr = e.message; S.user = null; }
    S.booting = false;
  }
  render();
})();
