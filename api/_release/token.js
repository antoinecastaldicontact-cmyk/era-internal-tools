// Signed tokens for the release form.
//
// RELEASE_SIGNING_SECRET (Vercel env) signs two kinds of token:
//   - the artist link: { r: recordId, iat } — valid as long as it is the one stored in
//     « Form Link » on the track record (clearing or regenerating the link revokes it);
//   - upload tokens: { u: Drive session URL, s: size, r } — 6 h, accepted only by the chunk relay.

import crypto from 'crypto';

function secret() {
  const s = process.env.RELEASE_SIGNING_SECRET;
  if (!s || s.length < 32) throw new Error('RELEASE_SIGNING_SECRET missing or too short.');
  return s;
}

const b64u = (s) => Buffer.from(s).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url').toString('utf8');

function sign(kind, payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret()).update(`${kind}.${body}`).digest('base64url');
  return `${body}.${sig}`;
}

function read(kind, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) throw new Error('Invalid link.');
  const expected = crypto.createHmac('sha256', secret()).update(`${kind}.${body}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid link.');
  return JSON.parse(unb64u(body));
}

export function signLink(recordId) {
  return sign('release-link', { r: recordId, iat: Math.floor(Date.now() / 1000), n: crypto.randomBytes(6).toString('base64url') });
}

export function readLink(token) {
  const p = read('release-link', token);
  if (!/^rec[A-Za-z0-9]{14}$/.test(String(p.r || ''))) throw new Error('Invalid link.');
  return p;
}

export function signUpload(payload, ttlSec = 6 * 3600) {
  return sign('release-upload', { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec });
}

export function readUpload(token) {
  const p = read('release-upload', token);
  if (p.exp < Math.floor(Date.now() / 1000)) throw new Error('Upload token expired: reload the page.');
  return p;
}
