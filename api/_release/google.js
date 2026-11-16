// Google Drive for the release form — same mechanism as the 129 onboarding (proven in prod):
//
// A. Apps Script (no Google Cloud project, no service account):
//   RELEASE_APPS_SCRIPT_URL    - /exec URL of the « ERA Release Drive » web app (tools/release-apps-script/).
//   RELEASE_APPS_SCRIPT_SECRET - secret printed by setup() in that script.
//   The script hands this server a short-lived Drive token and the root folder ID. The token never
//   reaches the browser: files go browser -> /api/release?action=chunk (4 MB pieces, under the
//   4.5 MB Vercel body limit) -> Drive resumable session.
//
// B. Service account (optional fallback):
//   GOOGLE_SERVICE_ACCOUNT_JSON + RELEASE_DRIVE_PARENT_FOLDER_ID (in a shared drive).

import crypto from 'crypto';

const SCOPE = 'https://www.googleapis.com/auth/drive';
let cached = { token: null, exp: 0 };
let scriptRoot = null;

const SCRIPT_URL = () => process.env.RELEASE_APPS_SCRIPT_URL;
const SCRIPT_SECRET = () => process.env.RELEASE_APPS_SCRIPT_SECRET;
const scriptMode = () => Boolean(SCRIPT_URL() && SCRIPT_SECRET());

async function scriptCall(body) {
  const r = await fetch(SCRIPT_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SCRIPT_SECRET(), ...body }),
    redirect: 'follow',
  });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { throw new Error('[Apps Script] non-JSON answer: check the web app is deployed with access « Anyone ».'); }
}

async function tokenFromScript() {
  const d = await scriptCall({});
  if (!d.token) throw new Error(`[Apps Script] ${d.error || 'no token'}`);
  scriptRoot = d.rootId || null;
  const now = Math.floor(Date.now() / 1000);
  cached = { token: d.token, exp: now + Math.min(Number(d.expiresIn) || 1200, 1800) };
  return cached.token;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;
  if (scriptMode()) return tokenFromScript();
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Drive not configured: RELEASE_APPS_SCRIPT_URL / RELEASE_APPS_SCRIPT_SECRET missing.');
  const sa = JSON.parse(raw);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`[Google auth] ${d.error_description || d.error || r.statusText}`);
  cached = { token: d.access_token, exp: now + (d.expires_in || 3600) };
  return cached.token;
}

export function driveConfigured() {
  return scriptMode() || Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.RELEASE_DRIVE_PARENT_FOLDER_ID);
}

async function drive(method, path, { query = {}, body } = {}) {
  const qs = new URLSearchParams({ supportsAllDrives: 'true', ...query });
  const r = await fetch(`https://www.googleapis.com/drive/v3/${path}?${qs}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`[Drive ${r.status}] ${d?.error?.message || r.statusText}`);
  return d;
}

export async function rootFolderId() {
  if (process.env.RELEASE_DRIVE_PARENT_FOLDER_ID) return process.env.RELEASE_DRIVE_PARENT_FOLDER_ID;
  if (scriptMode()) {
    if (!scriptRoot) { cached = { token: null, exp: 0 }; await accessToken(); }
    if (scriptRoot) return scriptRoot;
    throw new Error('[Apps Script] root folder unknown: run setup() in the script again.');
  }
  throw new Error('RELEASE_DRIVE_PARENT_FOLDER_ID missing.');
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Finds a sub-folder by name, or creates it. Idempotent.
export async function ensureFolder(name, parentId) {
  const found = await drive('GET', 'files', {
    query: {
      q: `name='${esc(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name,webViewLink)', includeItemsFromAllDrives: 'true', corpora: 'allDrives', pageSize: '1',
    },
  });
  if (found.files?.length) return found.files[0];
  return drive('POST', 'files', {
    query: { fields: 'id,name,webViewLink' },
    body: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
  });
}

export async function folderInfo(id) {
  return drive('GET', `files/${id}`, { query: { fields: 'id,name,webViewLink,trashed' } });
}

// Opens a resumable upload session; returns the session URL.
export async function startResumable({ name, mimeType, size, parentId }) {
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType || 'application/octet-stream',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, parents: [parentId] }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`[Drive upload ${r.status}] ${d?.error?.message || r.statusText}`);
  }
  const loc = r.headers.get('location');
  if (!loc) throw new Error('[Drive upload] no session URL returned.');
  return loc;
}

// Sends one chunk to an existing session. The session URL carries its own authorisation.
export async function putChunk(sessionUrl, buf, contentRange) {
  const r = await fetch(sessionUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(buf.length), 'Content-Range': contentRange },
    body: buf,
  });
  if (r.status === 308) {
    const range = r.headers.get('range');
    const next = range ? Number(range.split('-')[1]) + 1 : 0;
    return { done: false, next };
  }
  const d = await r.json().catch(() => ({}));
  if (r.status === 200 || r.status === 201) return { done: true, file: d };
  throw new Error(`[Drive chunk ${r.status}] ${d?.error?.message || r.statusText}`);
}

export function isDriveSessionUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === 'www.googleapis.com' && x.pathname.startsWith('/upload/drive/v3/files');
  } catch { return false; }
}

// Small file (JSON archive) in one request.
export async function uploadSmall({ name, mimeType, content, parentId }) {
  const boundary = 'era' + crypto.randomBytes(8).toString('hex');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(String(content)),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`[Drive multipart ${r.status}] ${d?.error?.message || r.statusText}`);
  return d;
}

// Internal mail through the same Apps Script (MailApp). Never throws.
export async function sendMail({ to, subject, text, html, replyTo }) {
  try {
    if (!scriptMode()) return { ok: false, error: 'RELEASE_APPS_SCRIPT_URL / SECRET missing: mail not sent.' };
    const d = await scriptCall({ action: 'mail', to, subject, text, html, replyTo });
    return d.sent ? { ok: true } : { ok: false, error: d.error || 'mail not sent' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
