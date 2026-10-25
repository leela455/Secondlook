// Centralised API client: base URL, auth header, JSON envelope handling, timeouts, expired-session handling,
// and upload progress. Nothing else in the frontend calls fetch() directly.
const API = (() => {
  const base = ((window.SECONDLOOK_CONFIG && window.SECONDLOOK_CONFIG.API_BASE_URL) || '').replace(/\/$/, '') + '/api/v1';
  const KEY = 'secondlook.token';
  let onExpired = () => {};

  const store = {
    get() { try { return sessionStorage.getItem(KEY) || ''; } catch (_) { return ''; } },
    set(t) { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch (_) {} },
  };

  class ApiError extends Error {
    constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
  }

  const qs = (o) => {
    const p = new URLSearchParams();
    Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && v !== 'All') p.set(k, v); });
    const s = p.toString();
    return s ? '?' + s : '';
  };

  function fail(status, body) {
    const e = (body && body.error) || {};
    if (status === 401 && store.get()) { store.set(''); onExpired(e.message); }
    return new ApiError(status, e.code || 'ERROR', e.message || `Request failed (${status})`, e.details);
  }

  async function request(method, path, { body, form, signal, raw } = {}) {
    const headers = {};
    const tk = store.get();
    if (tk) headers.Authorization = 'Bearer ' + tk;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    if (signal) signal.addEventListener('abort', () => ctl.abort());
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : form, signal: ctl.signal });
    } catch (e) {
      throw new ApiError(0, 'NETWORK', ctl.signal.aborted && !(signal && signal.aborted) ? 'The server took too long to respond.' : 'Cannot reach the server. Check that the backend is running and try again.');
    } finally { clearTimeout(timer); }
    if (raw && res.ok) return res;
    let json = null;
    try { json = await res.json(); } catch (_) {}
    if (!res.ok || !json || json.success === false) throw fail(res.status, json);
    return json;
  }

  // multipart upload with progress (fetch cannot report upload progress)
  function upload(path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', base + path);
      const tk = store.get();
      if (tk) x.setRequestHeader('Authorization', 'Bearer ' + tk);
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
      x.onerror = () => reject(new ApiError(0, 'NETWORK', 'Upload failed: cannot reach the server.'));
      x.ontimeout = () => reject(new ApiError(0, 'NETWORK', 'Upload timed out.'));
      x.timeout = 120000;
      x.onload = () => {
        let json = null;
        try { json = JSON.parse(x.responseText); } catch (_) {}
        if (x.status >= 200 && x.status < 300 && json && json.success) resolve(json);
        else reject(fail(x.status, json));
      };
      x.send(formData);
    });
  }

  // Images need the Authorization header, so <img src> cannot be used directly: fetch -> blob URL (cached).
  const imgCache = new Map();
  async function image(code, n) {
    const k = code + '#' + n;
    if (imgCache.has(k)) return imgCache.get(k);
    const p = request('GET', `/inspections/${encodeURIComponent(code)}/evidence/${n}/image`, { raw: true })
      .then((r) => r.blob()).then((b) => URL.createObjectURL(b));
    imgCache.set(k, p);
    p.catch(() => imgCache.delete(k));
    return p;
  }

  return {
    ApiError, qs, store, image, upload,
    onExpired: (fn) => { onExpired = fn; },
    get: (p) => request('GET', p),
    post: (p, body) => request('POST', p, { body: body === undefined ? {} : body }),
    put: (p, body) => request('PUT', p, { body }),
    patch: (p, body) => request('PATCH', p, { body }),
    del: (p) => request('DELETE', p),
    // domain helpers
    login: (b) => request('POST', '/auth/login', { body: b }),
    register: (b) => request('POST', '/auth/register', { body: b }),
    logout: () => request('POST', '/auth/logout', { body: {} }),
    me: () => request('GET', '/auth/me'),
  };
})();
