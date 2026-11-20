// /api/release?action=…  — release form backend (one function, routed by `action`).
//
//   GET  mint&r=rec…        Airtable automation: creates the artist link when Pipeline = « Lien à envoyer ».
//                           Writes the link into Airtable only, never returns it.
//   GET  config&t=…         Prefill + current draft for the artist link.
//   POST save&t=…           { data, progress } — draft, any time.
//   POST search&t=…         { kind: 'artist'|'person', q } — artists: public profile; people: names only.
//   POST upload-start&t=…   { files: [{ name, size, type, kind, label }] } — Drive sessions + upload tokens.
//   POST chunk              raw bytes (<= 4 MB), headers X-Upload-Token / X-Chunk-Start / X-Total-Size.
//   POST artwork&t=…        { contentType, filename, base64 } — artwork preview in Airtable (reduced JPEG).
//   POST submit&t=…         { data } — final release: validate, write Airtable, archive, notify.
//
// Env: AIRTABLE_TOKEN, RELEASE_SIGNING_SECRET, RELEASE_APPS_SCRIPT_URL, RELEASE_APPS_SCRIPT_SECRET,
//      RELEASE_NOTIFY_EMAILS (optional), RELEASE_PUBLIC_BASE (optional).

import { T, F, FN, PIPELINE, LOCKED, RELEASE_TYPE, PUBLISHER_CHOICE, q, find, get, create, update, uploadAttachment, recordUrl } from './_release/airtable.js';
import { driveConfigured, rootFolderId, ensureFolder, folderInfo, startResumable, putChunk, isDriveSessionUrl, uploadSmall, sendMail, shareFolder } from './_release/google.js';
import { signLink, readLink, signUpload, readUpload } from './_release/token.js';
import { validate, clampData, FILE_KINDS, MASTERING, MAX_FILE_BYTES, MAX_FILES, personName, isInstrumental } from '../release-form/rules.js';

const MAX_CHUNK = 4 * 1024 * 1024;
const REC = /^rec[A-Za-z0-9]{14}$/;
const clean = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(v || '').trim());
const nowIso = () => new Date().toISOString();
const parisDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const parisStamp = () => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }).format(new Date());

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

async function readJson(req, limit = 4_200_000) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request too large.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, 'Unreadable request.'); }
}

function baseUrl(req) {
  if (process.env.RELEASE_PUBLIC_BASE) return process.env.RELEASE_PUBLIC_BASE.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

// The link must be valid AND still be the one stored on the record (regenerating revokes the old one).
async function loadTrack(t) {
  let p;
  try { p = readLink(t); } catch { throw new HttpError(403, 'This link is not valid. Ask ERA for a new one.'); }
  let track;
  try { track = await get(T.tracks, p.r); } catch { throw new HttpError(404, 'Release not found. Ask ERA for a new link.'); }
  const link = String(track.fields?.[F.track.formLink] || '');
  if (!link.includes(String(t))) throw new HttpError(403, 'This link has been replaced. Ask ERA for the new one.');
  return track;
}

const isLocked = (track) => LOCKED.includes(track.fields?.[F.track.pipeline]);

function titleFromProduct(product, artistNames) {
  const s = String(product || '').trim();
  const i = s.indexOf(' - ');
  if (i < 0) return s;
  const head = s.slice(0, i).toLowerCase();
  if (!artistNames.length || artistNames.some(n => head.includes(String(n).toLowerCase()))) return s.slice(i + 3).trim();
  return s;
}

function personSummary(rec) {
  const f = rec.fields || {};
  const missing = [];
  if (!isEmail(f[F.person.email])) missing.push('email');
  if (!clean(f[F.person.address], 2000)) missing.push('address');
  if (!f[F.person.nationality]) missing.push('nationality');
  return { id: rec.id, name: clean(f[F.person.name], 150), missing };
}

// Rich text from Airtable comes back as markdown with a trailing newline.
const plain = (v) => String(v ?? '').replace(/\r/g, '').trim();
const thumb = (att) => (att || []).find(a => /^image\//.test(a.type || ''))?.thumbnails?.large?.url || null;

// Public artist profile: safe to show to anyone holding a release link, editable in the form.
const ARTIST_PROFILE = [
  ['spotify', 'spotifyId', 'Spotify', 300], ['apple', 'apple', 'Apple Music', 300], ['instagram', 'instagram', 'Instagram', 300],
  ['tiktok', 'tiktok', 'TikTok', 300], ['youtube', 'youtube', 'YouTube', 300], ['soundcloud', 'soundcloud', 'SoundCloud', 300],
  ['bio', 'bio', 'Bio', 3000],
];
const URL_FIELDS = new Set(['apple', 'youtube', 'soundcloud']);
function artistProfile(rec) {
  const f = rec.fields || {};
  const out = { id: rec.id, name: clean(f[F.artist.name], 150) };
  for (const [k, key, , max] of ARTIST_PROFILE) out[k] = clean(plain(f[F.artist[key]]), max);
  out.photo = thumb(f[F.artist.photos]) || thumb(f[F.artist.presskit]);
  return out;
}
// Airtable url fields: keep only something that reads as a link.
function profileValue(k, v, max) {
  const t = clean(v, max);
  if (!t || !URL_FIELDS.has(k)) return t;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+\//.test(t)) return 'https://' + t;
  return '';
}

// Full details, only for the people ERA already links to the release's main artists
// (set by ERA on the Airtable record, never by the form): the artist sees and edits their own team.
function personDetails(rec) {
  const f = rec.fields || {};
  const pub = f[F.person.anyPublishers];
  const proName = clean(f[F.person.proName], 100);
  const ipi = clean(f[F.person.ipi], 40);
  return {
    ...personSummary(rec), owned: true,
    legalName: clean(f[F.person.name], 150), alias: clean(plain(f[F.person.alias]), 150),
    email: clean(f[F.person.email], 200), phone: clean(f[F.person.phone], 40),
    address: clean(plain(f[F.person.address]), 600), nationality: clean(f[F.person.nationality], 20),
    pro: proName || ipi ? 'yes' : '', proName, ipi,
    publisher: pub === PUBLISHER_CHOICE.yes ? 'yes' : pub === PUBLISHER_CHOICE.no ? 'no' : '',
    publisherInfo: clean(plain(f[F.person.publishersInfo]), 1000),
  };
}
async function ownedPeople(track) {
  const mainIds = (track.fields?.[F.track.mainArtist] || []).slice(0, 4);
  const mains = (await Promise.all(mainIds.map(id => get(T.artists, id).catch(() => null)))).filter(Boolean);
  const ids = [...new Set(mains.flatMap(a => a.fields?.[F.artist.rightholders] || []))].slice(0, 12);
  return { mains, ids: new Set(ids), people: (await Promise.all(ids.map(id => get(T.people, id).catch(() => null)))).filter(Boolean) };
}
const PERSON_LABELS = {
  [F.person.name]: 'Nom légal', [F.person.email]: 'Email', [F.person.address]: 'Adresse', [F.person.nationality]: 'Nationalité',
  [F.person.alias]: 'Alias', [F.person.phone]: 'WhatsApp', [F.person.proName]: 'Société de gestion', [F.person.ipi]: 'IPI',
  [F.person.anyPublishers]: 'Éditeur', [F.person.publishersInfo]: 'Infos éditeur',
};

// ---------- actions ----------

async function mint(req, res) {
  const r = String(req.query.r || '');
  const page = (msg) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html><meta charset="utf-8"><title>ERA</title><body style="font:15px system-ui;background:#050507;color:#e8e8f0;padding:40px">${msg}</body>`);
  };
  if (!REC.test(r)) return page('Nothing to do.');
  let track;
  try { track = await get(T.tracks, r); } catch { return page('Nothing to do.'); }
  if (track.fields?.[F.track.pipeline] !== PIPELINE.toSend) return page('Nothing to do: Pipeline is not « Lien à envoyer ».');
  const url = `${baseUrl(req)}/release-form/?t=${signLink(r)}`;
  await update(T.tracks, r, { [F.track.formLink]: url, [F.track.pipeline]: PIPELINE.sent });
  return page('Link created. It is in the « Form Link » field in Airtable.');
}

async function config(req, res) {
  const track = await loadTrack(req.query.t);
  const f = track.fields || {};
  const { mains, people } = await ownedPeople(track);
  const mainArtists = mains.map(artistProfile);
  const photosOnFile = mains.some(a => (a.fields?.[F.artist.photos] || []).length > 0 || (a.fields?.[F.artist.presskit] || []).length > 0);
  let data = null;
  try { data = f[F.track.formData] ? JSON.parse(f[F.track.formData]) : null; } catch { data = null; }
  const type = String(f[F.track.releaseType] || '').trim();
  return res.status(200).json({
    productName: clean(f[F.track.name], 200),
    title: titleFromProduct(f[F.track.name], mainArtists.map(a => a.name)),
    releaseDate: f[F.track.releaseDate] || null,
    releaseType: type === 'EP' ? 'EP' : 'Single',
    artworkUrl: thumb(f[F.track.artwork]),
    mainArtists,
    knownPeople: people.map(personDetails),
    photosOnFile,
    status: f[F.track.pipeline] || '',
    locked: isLocked(track),
    correctionNote: f[F.track.pipeline] === PIPELINE.correction ? clean(f[F.track.correctionNote], 3000) : '',
    submittedAt: f[F.track.formSubmittedAt] || null,
    driveFolder: isLocked(track) ? (f[F.track.driveFolder] || null) : null,
    data,
  });
}

async function save(req, res) {
  const track = await loadTrack(req.query.t);
  if (isLocked(track)) throw new HttpError(409, 'This release has been submitted. ERA will reopen it if something needs changing.');
  const b = await readJson(req);
  const data = clampData(b.data);
  const progress = Math.max(0, Math.min(100, Number(b.progress) || 0));
  const fields = {
    [F.track.formData]: JSON.stringify(data),
    [F.track.formProgress]: progress / 100,
    [F.track.formLastSaved]: nowIso(),
  };
  const st = track.fields?.[F.track.pipeline];
  if (!st || st === PIPELINE.toSend || st === PIPELINE.sent) fields[F.track.pipeline] = PIPELINE.draft;
  await update(T.tracks, track.id, fields);
  return res.status(200).json({ ok: true, savedAt: fields[F.track.formLastSaved] });
}

async function search(req, res) {
  await loadTrack(req.query.t);
  const b = await readJson(req);
  const term = clean(b.q, 80).toLowerCase();
  if (term.length < 3) return res.status(200).json({ results: [] });
  if (b.kind === 'artist') {
    const rows = await find(T.artists, `SEARCH(${q(term)}, LOWER(${FN.artistName}))`, { maxRecords: 6 });
    return res.status(200).json({ results: rows.map(artistProfile).filter(r => r.name) });
  }
  if (b.kind === 'person') {
    // Names only (or one exact email match). No email, address or ID is ever returned.
    const formula = isEmail(term)
      ? `LOWER(${FN.personEmail}) = ${q(term)}`
      : `SEARCH(${q(term)}, LOWER(${FN.personName}))`;
    const rows = await find(T.people, formula, { maxRecords: 6, fields: [F.person.name, F.person.email, F.person.address, F.person.nationality] });
    return res.status(200).json({ results: rows.map(personSummary).filter(r => r.name) });
  }
  throw new HttpError(400, 'Unknown search.');
}

async function trackFolder(track) {
  const f = track.fields || {};
  const id = f[F.track.gdriveFolderId];
  if (id) {
    try {
      const info = await folderInfo(id);
      if (!info.trashed) return { id: info.id, url: info.webViewLink || f[F.track.driveFolder] };
    } catch { /* folder gone: create a new one */ }
  }
  // RELEASES / « 2026 - ERA Music » / « Artist - Title » — same layout as the folders made by hand.
  // Year = year of the planned release date, else the current year (Paris). An existing folder with
  // the same name is reused, so files land next to what is already there.
  const rd = String(f[F.track.releaseDate] || '');
  const year = /^\d{4}-/.test(rd) ? rd.slice(0, 4) : parisDate().slice(0, 4);
  const yearFolder = await ensureFolder(`${year} - ERA Music`, await rootFolderId());
  const name = (clean(f[F.track.name], 150) || track.id).replace(/[\\/]/g, '-');
  const folder = await ensureFolder(name, yearFolder.id);
  await update(T.tracks, track.id, { [F.track.gdriveFolderId]: folder.id, [F.track.driveFolder]: folder.webViewLink });
  return { id: folder.id, url: folder.webViewLink };
}

async function uploadStart(req, res) {
  const track = await loadTrack(req.query.t);
  if (isLocked(track)) throw new HttpError(409, 'This release has been submitted.');
  if (!driveConfigured()) throw new HttpError(503, 'File storage is not configured yet. Save your draft and try again later.');
  const b = await readJson(req);
  const files = Array.isArray(b.files) ? b.files.slice(0, 10) : [];
  if (!files.length) throw new HttpError(400, 'No file.');
  for (const x of files) {
    if (!FILE_KINDS[x.kind]) throw new HttpError(400, 'Unknown file type.');
    const size = Number(x.size);
    if (!Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) throw new HttpError(400, `${clean(x.name, 80)}: file too large (5 GB max). Share it as a link instead.`);
  }
  const folder = await trackFolder(track);
  const uploads = [];
  for (const x of files) {
    const prefix = FILE_KINDS[x.kind].prefix;
    const label = clean(x.label, 60);
    const name = `${prefix} - ${label ? label + ' - ' : ''}${clean(x.name, 180)}`.replace(/[\\/]/g, '-');
    const u = await startResumable({ name, mimeType: clean(x.type, 100) || 'application/octet-stream', size: Number(x.size), parentId: folder.id });
    uploads.push({ token: signUpload({ u, s: Number(x.size), r: track.id }) });
  }
  return res.status(200).json({ uploads });
}

async function chunk(req, res) {
  let p;
  try { p = readUpload(req.headers['x-upload-token']); } catch (e) { throw new HttpError(403, e.message); }
  if (!isDriveSessionUrl(p.u)) throw new HttpError(403, 'Upload session refused.');
  const start = Number(req.headers['x-chunk-start']);
  const total = Number(req.headers['x-total-size']);
  if (!Number.isInteger(start) || start < 0 || total !== p.s) throw new HttpError(400, 'Invalid chunk headers.');
  // Raw stream: never touch req.body here.
  const parts = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_CHUNK) throw new HttpError(413, 'Chunk too large.');
    parts.push(c);
  }
  const buf = Buffer.concat(parts);
  if (!buf.length || start + buf.length > total) throw new HttpError(400, 'Empty or out-of-range chunk.');
  try {
    const out = await putChunk(p.u, buf, `bytes ${start}-${start + buf.length - 1}/${total}`);
    if (out.done) return res.status(200).json({ done: true, fileId: out.file?.id || null, name: out.file?.name || null });
    return res.status(200).json({ done: false, next: out.next });
  } catch (e) {
    console.error('[release chunk]', e.message);
    throw new HttpError(502, 'Upload interrupted, retrying…');
  }
}

// Artwork preview in Airtable (the full-size file stays on Drive). Sent by the page right after the
// artwork upload, as a JPEG reduced in the browser (<= 4 MB). Replaces the previous preview.
async function artwork(req, res) {
  const track = await loadTrack(req.query.t);
  if (isLocked(track)) throw new HttpError(409, 'This release has been submitted.');
  const b = await readJson(req);
  if (!['image/jpeg', 'image/png'].includes(b.contentType) || typeof b.base64 !== 'string' || b.base64.length > 5_500_000) {
    throw new HttpError(400, 'Artwork preview refused.');
  }
  await update(T.tracks, track.id, { [F.track.artwork]: [] });
  await uploadAttachment(track.id, F.track.artwork, { contentType: b.contentType, filename: clean(b.filename, 150) || 'artwork.jpg', base64: b.base64 });
  return res.status(200).json({ ok: true });
}

// ---------- submit ----------

async function resolveArtist(a, log) {
  const name = clean(a?.name, 150);
  let rec = null;
  if (a?.id && REC.test(a.id)) rec = await get(T.artists, a.id).catch(() => null);
  if (!rec && name) {
    const same = await find(T.artists, `LOWER(${FN.artistName}) = ${q(name.toLowerCase())}`, { maxRecords: 2 });
    if (same.length === 1) rec = same[0];
  }
  if (rec) {
    // Existing artist: the profile fields the artist changed overwrite the base; an emptied field is left as it was.
    const cur = rec.fields || {};
    const fill = {};
    const changes = [];
    for (const [k, key, label, max] of ARTIST_PROFILE) {
      const v = profileValue(k, a[k], max);
      const was = plain(cur[F.artist[key]]);
      if (v && v !== was) { fill[F.artist[key]] = v; changes.push(`${label} « ${was || '—'} » → « ${v} »`); }
    }
    if (changes.length) {
      fill[F.artist.ficheStatus] = 'À valider';
      await update(T.artists, rec.id, fill);
      log.artistsChanged.push(`${clean(cur[F.artist.name], 150)} : ${changes.join(' ; ')}`);
    }
    return rec.id;
  }
  if (!name) return null;
  const fields = { [F.artist.name]: name, [F.artist.ficheStatus]: 'À valider' };
  for (const [k, key, , max] of ARTIST_PROFILE) { const v = profileValue(k, a[k], max); if (v) fields[F.artist[key]] = v; }
  const created = await create(T.artists, fields);
  log.artistsCreated.push(name);
  return created.id;
}

function personFields(p) {
  // One postal address field (older drafts kept street / postcode / city / country apart).
  const address = clean(p.address, 600) || [clean(p.street, 200), [clean(p.postcode, 20), clean(p.city, 100)].filter(Boolean).join(' '), clean(p.country, 80)].filter(Boolean).join(', ');
  return {
    [F.person.name]: clean(personName(p), 150),
    [F.person.email]: isEmail(p.email) ? clean(p.email, 200).toLowerCase() : '',
    [F.person.address]: address,
    [F.person.nationality]: clean(p.nationality, 20),
    [F.person.alias]: clean(p.alias, 150),
    [F.person.phone]: clean(p.phone, 40),
    [F.person.proName]: p.pro === 'yes' ? clean(p.proName, 100) : '',
    [F.person.ipi]: p.pro === 'yes' ? clean(p.ipi, 40) : '',
    [F.person.anyPublishers]: p.publisher === 'yes' ? PUBLISHER_CHOICE.yes : (p.publisher === 'no' ? PUBLISHER_CHOICE.no : ''),
    [F.person.publishersInfo]: p.publisher === 'yes' ? clean(p.publisherInfo, 1000) : '',
  };
}

// Existing record: fill empty fields only, never overwrite.
async function updatePerson(id, p, log, owned) {
  const rec = await get(T.people, id);
  const cur = rec.fields || {};
  const wanted = personFields(p);
  const fill = {};
  const changes = [];
  for (const [k, v] of Object.entries(wanted)) {
    if (!v) continue;                                   // an emptied field is left as it was
    if (k === F.person.name && !owned) continue;        // a legal name is only edited by the artist's own team
    const was = plain(cur[k]);
    if (String(v).toLowerCase() === was.toLowerCase()) continue;
    fill[k] = v;
    changes.push(`${PERSON_LABELS[k] || k} « ${was || '—'} » → « ${v} »`);
  }
  const name = clean(fill[F.person.name] || cur[F.person.name], 150) || personName(p);
  if (changes.length) {
    fill[F.person.ficheStatus] = 'À valider';
    await update(T.people, id, fill);
    log.changed.push(`${clean(cur[F.person.name], 150)} : ${changes.join(' ; ')}`);
  }
  return { id, name, email: clean(fill[F.person.email] || cur[F.person.email], 200) };
}

async function resolvePerson(p, track, log, ownedIds) {
  if (p.id && REC.test(p.id)) {
    try { return await updatePerson(p.id, p, log, ownedIds.has(p.id)); } catch { /* not found: create below */ }
  }
  if (isEmail(p.email)) {
    const byEmail = await find(T.people, `LOWER(${FN.personEmail}) = ${q(clean(p.email, 200).toLowerCase())}`, { maxRecords: 2, fields: [F.person.name] });
    if (byEmail.length === 1) {
      log.matched.push(`${personName(p)} → ${clean(byEmail[0].fields?.[F.person.name], 150)}`);
      return updatePerson(byEmail[0].id, p, log, false);
    }
  }
  const name = personName(p);
  const homonyms = await find(T.people, `LOWER(${FN.personName}) = ${q(name.toLowerCase())}`, { maxRecords: 2, fields: [F.person.name] });
  if (homonyms.length) log.homonyms.push(name);
  const fields = Object.fromEntries(Object.entries(personFields(p)).filter(([, v]) => v));
  fields[F.person.ficheStatus] = 'À valider';
  fields[F.person.notes] = `Créé par le formulaire de release « ${clean(track.fields?.[F.track.name], 150)} » le ${parisStamp()}.`;
  const rec = await create(T.people, fields);
  log.created.push(name);
  return { id: rec.id, name, email: fields[F.person.email] || '' };
}

function qcFlags(data, track, v, log) {
  const flags = [];
  const files = data.files || [];
  const master = files.find(f => f.kind === 'master' && f.status === 'done');
  const c = master?.checks || {};
  if (c.format && c.format !== 'wav') flags.push(`Master : format ${c.format} (WAV attendu)`);
  if (c.bitDepth && c.bitDepth < 24) flags.push(`Master : ${c.bitDepth} bits (24 bits attendu)`);
  if (c.sampleRate && ![44100, 48000, 88200, 96000].includes(c.sampleRate)) flags.push(`Master : ${c.sampleRate} Hz`);
  if (c.channels && c.channels !== 2) flags.push(`Master : ${c.channels} canal(aux)`);
  if (c.duration && (c.duration < 60 || c.duration > 900)) flags.push(`Master : durée ${Math.round(c.duration)} s`);
  if (Number.isFinite(c.peakDb) && c.peakDb > -0.1) flags.push(`Master : crête à ${c.peakDb.toFixed(2)} dBFS (saturation possible)`);
  const art = files.find(f => f.kind === 'artwork' && f.status === 'done')?.checks || {};
  if (art.width && (art.width !== art.height)) flags.push(`Artwork non carré : ${art.width}×${art.height}`);
  else if (art.width && art.width < 3000) flags.push(`Artwork ${art.width}×${art.height} (3000×3000 attendu)`);
  const versions = files.filter(f => f.kind === 'version' && f.status === 'done');
  if (versions.length) flags.push(`Versions livrées en plus (une fiche titre chacune à créer) : ${versions.map(f => f.label || f.name).join(', ')}`);
  const rd = track.fields?.[F.track.releaseDate];
  if (rd) {
    const days = Math.round((new Date(rd + 'T12:00:00Z') - Date.now()) / 86400000);
    if (days < 21) flags.push(`Sortie dans ${days} jours : J-21 dépassé`);
  }
  if (data.release?.type === 'EP') flags.push(`Fait partie de l'EP « ${clean(data.release.epTitle, 150)} »`);
  for (const w of v.warnings) flags.push(`Formulaire : ${w.label}`);
  const parsed = titleFromProduct(track.fields?.[F.track.name], []);
  if (clean(data.release?.title, 200) && clean(data.release.title, 200).toLowerCase() !== clean(parsed, 200).toLowerCase()) {
    flags.push(`Titre saisi par l'artiste : « ${clean(data.release.title, 200)} » (fiche : « ${clean(track.fields?.[F.track.name], 200)} ») — Product Name non modifié`);
  }
  if (log.artistsCreated.length) flags.push(`Nouveaux artistes à valider : ${log.artistsCreated.join(', ')}`);
  for (const x of log.artistsChanged) flags.push(`Profil artiste modifié — ${x}`);
  if (log.created.length) flags.push(`Nouvelles fiches ayants droits à valider : ${log.created.join(', ')}`);
  for (const x of log.changed) flags.push(`Fiche ayant droit modifiée — ${x}`);
  if (log.matched.length) flags.push(`Rattachés par email à une fiche existante : ${log.matched.join(' ; ')}`);
  if (log.homonyms.length) flags.push(`Homonyme déjà en base, vérifier le doublon : ${log.homonyms.join(', ')}`);
  return flags;
}

function pitchText(pt) {
  return [
    ['Story', pt.story], ['Mood', pt.mood], ['Sounds like', pt.references],
    ['Support so far', pt.supports], ['Key markets', pt.markets],
  ].filter(([, v]) => clean(v, 5000)).map(([k, v]) => `**${k}**\n${clean(v, 5000)}`).join('\n\n');
}

async function submit(req, res) {
  const track = await loadTrack(req.query.t);
  if (isLocked(track)) throw new HttpError(409, 'This release has already been submitted.');
  const b = await readJson(req);
  const data = clampData(b.data);

  const owned = await ownedPeople(track);
  const photosOnFile = owned.mains.some(a => (a.fields?.[F.artist.photos] || []).length > 0 || (a.fields?.[F.artist.presskit] || []).length > 0);
  const v = validate(data, { photosOnFile });
  if (v.missing.length) throw new HttpError(422, 'Some required information is missing.', { missing: v.missing });

  const log = { artistsCreated: [], artistsChanged: [], created: [], changed: [], matched: [], homonyms: [] };
  const r = data.release;
  const mainArtistIds = [];
  for (const a of r.mainArtists || []) { const id = await resolveArtist(a, log); if (id) mainArtistIds.push(id); }
  const featIds = [];
  for (const a of r.featuredArtists || []) { const id = await resolveArtist(a, log); if (id) featIds.push(id); }

  const people = data.people || {};
  const c = data.credits || {};
  const pubRows = data.publishing?.applicable === 'yes' ? (data.publishing.rows || []) : [];
  const keys = [...new Set([...(c.composers || []), ...(c.lyricists || []), ...(c.producers || []),
    ...(data.rightholders || []).map(x => x.key), ...pubRows.map(x => x.key)])].filter(k => people[k]);
  const resolved = {};
  for (const k of keys) resolved[k] = await resolvePerson(people[k], track, log, owned.ids);   // sequential: dedup by email between rows

  const ids = (list) => [...new Set((list || []).map(k => resolved[k]?.id).filter(Boolean))];
  const names = (list) => (list || []).map(k => resolved[k]?.name || personName(people[k])).filter(Boolean);
  const splitLines = (rows) => rows.map(x => `${resolved[x.key]?.name || personName(people[x.key])} - ${Number(x.share)}%`).join('\n');

  const masteringOk = MASTERING.includes(c.mastering);
  const extra = [
    c.mastering === 'Other' ? `Mastering: ${clean(c.masteringOther, 150)}` : '',
    clean(c.other, 2000),
    r.type === 'EP' ? `EP: ${clean(r.epTitle, 150)}` : '',
  ].filter(Boolean).join('\n');

  const flags = qcFlags(data, track, v, log);
  const stamp = nowIso();
  const fields = {
    [F.track.version]: clean(r.version, 80),
    [F.track.genre]: clean(r.genre, 60),
    [F.track.language]: clean(r.language, 60),
    [F.track.explicit]: r.explicit === 'yes',
    [F.track.bpm]: Number.isFinite(Number(r.bpm)) && clean(r.bpm) ? Math.round(Number(r.bpm)) : null,
    [F.track.key]: clean(r.key, 30),
    [F.track.previewStart]: clean(r.previewStart, 10),
    [F.track.releaseType]: RELEASE_TYPE[r.type === 'EP' ? 'EP' : 'Single'],
    [F.track.lyrics]: isInstrumental(data) ? '' : clean(data.lyrics, 20000),
    [F.track.artistPitch]: pitchText(data.pitch || {}),
    [F.track.mastering]: masteringOk ? c.mastering : null,
    [F.track.mixEngineer]: clean(c.mix, 150),
    [F.track.extraMeta]: extra,
    [F.track.composers]: ids(c.composers),
    [F.track.lyricists]: isInstrumental(data) ? [] : ids(c.lyricists),
    [F.track.producers]: ids(c.producers),
    [F.track.composersText]: names(c.composers).join('; '),
    [F.track.producersText]: names(c.producers).join('; '),
    [F.track.mainArtist]: mainArtistIds,
    [F.track.secondaryArtist]: featIds,
    [F.track.rightholders]: ids((data.rightholders || []).map(x => x.key)),
    [F.track.splitMaster]: splitLines(data.rightholders || []),
    [F.track.splitEdition]: data.publishing?.applicable === 'yes' ? splitLines(pubRows) : 'Publishing Not Applicable',
    [F.track.promoLinks]: clean(data.promoLinks, 5000),
    [F.track.formData]: JSON.stringify(data),
    [F.track.formProgress]: 1,
    [F.track.formLastSaved]: stamp,
    [F.track.formSubmittedAt]: stamp,
    [F.track.pipeline]: PIPELINE.submitted,
    [F.track.qcFlags]: flags.length ? flags.map(x => '• ' + x).join('\n') : 'Aucune alerte automatique.',
  };
  await update(T.tracks, track.id, fields);

  const warnings = [];

  // Raw archive next to the files.
  let folderUrl = track.fields?.[F.track.driveFolder] || null;
  let folderId = null;
  try {
    if (driveConfigured()) {
      const folder = await trackFolder(track);
      folderUrl = folder.url;
      folderId = folder.id;
      await uploadSmall({ name: `FORM - ${clean(track.fields?.[F.track.name], 150)} - ${parisDate()} ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date()).replace(':', 'h')}.json`, mimeType: 'application/json', content: JSON.stringify(data, null, 2), parentId: folder.id });
    }
  } catch (e) { warnings.push('archive Drive: ' + e.message); }

  // The artist: rightholders of this release ERA links to a main artist; else every rightholder.
  const mainPeople = new Set();
  for (const id of mainArtistIds) {
    const a = owned.mains.find(m => m.id === id) || await get(T.artists, id).catch(() => null);
    for (const pid of a?.fields?.[F.artist.rightholders] || []) mainPeople.add(pid);
  }
  const holders = (data.rightholders || []).map(x => resolved[x.key]).filter(Boolean);
  const pick = holders.filter(h => mainPeople.has(h.id));
  const recipients = [...new Set((pick.length ? pick : holders).map(h => clean(h.email, 200).toLowerCase()).filter(isEmail))].slice(0, 5);

  // Edit access to the release folder: the artist keeps adding content there after submitting.
  const shared = [];
  if (folderId && recipients.length) {
    for (const email of recipients) {
      try { await shareFolder(folderId, email); shared.push(email); } catch (e) { warnings.push(`partage Drive ${email}: ${e.message}`); }
    }
  }

  const productName = clean(track.fields?.[F.track.name], 150);
  const title = clean(r.title, 150) || productName;
  if (recipients.length) {
    const body = ['Hi,', '', `ERA received the release form for ${title}.`, ''];
    if (folderUrl && shared.length) {
      body.push(`Your release folder: ${folderUrl}`, 'You have edit access. Add photos or content for this release there at any time: everything for the release stays in this one folder.', '');
    }
    body.push('Next: ERA checks every element. If something needs changing, the same form link reopens with a note.', '', 'ERA Music');
    const sent = await sendMail({ to: recipients, subject: `ERA Music · ${title} received`, text: body.join('\n') });
    if (!sent.ok) warnings.push('mail artiste: ' + sent.error);
  } else {
    warnings.push('aucun email ayant droit : pas de mail artiste ni de partage Drive');
  }
  if (recipients.length) await update(T.tracks, track.id, { [F.track.formContactEmail]: recipients[0] }).catch(() => {});

  const to = (process.env.RELEASE_NOTIFY_EMAILS || 'acastaldi@eramusic.io').split(/[\s,;]+/).filter(isEmail);
  const lines = [
    `Formulaire de release envoyé : ${productName}`,
    `Mail artiste : ${recipients.join(', ') || '—'}`,
    `Accès Drive en écriture : ${shared.join(', ') || '—'}`,
    `Airtable : ${recordUrl(T.tracks, track.id)}`,
    folderUrl ? `Drive : ${folderUrl}` : '',
    '', 'Contrôles automatiques :', ...(flags.length ? flags.map(x => '• ' + x) : ['Aucune alerte.']),
    ...(warnings.length ? ['', ...warnings.map(w => '⚠ ' + w)] : []),
    '', 'Prochaine étape : QC dans Airtable (Pipeline → QC validé ou Correction demandée).',
  ];
  const mail = await sendMail({ to, subject: `Release form · ${productName}`, text: lines.join('\n'), replyTo: recipients[0] });
  if (!mail.ok) {
    console.error('[release submit] mail', mail.error);
    warnings.push('mail: ' + mail.error);
  }
  if (warnings.length) {
    await update(T.tracks, track.id, { [F.track.qcFlags]: `${fields[F.track.qcFlags]}\n${warnings.map(w => '⚠ ' + w).join('\n')}` }).catch(() => {});
  }
  return res.status(200).json({ ok: true, emailed: recipients, folder: shared.length ? folderUrl : null });
}

// ---------- router ----------

// Status only, no data: is Airtable reachable, can the server write to Drive (Apps Script token,
// Drive API, root folder)? Safe to call from anywhere.
async function health(req, res) {
  const out = { airtable: 'error', drive: driveConfigured() ? 'error' : 'not_configured' };
  try { await find(T.tracks, 'TRUE()', { maxRecords: 1, fields: [F.track.name] }); out.airtable = 'ok'; } catch { /* stays error */ }
  if (driveConfigured()) {
    try {
      const info = await folderInfo(await rootFolderId());
      out.drive = info.trashed ? 'root_in_trash' : 'ok';
      out.root = info.name;
    } catch (e) {
      out.driveError = String(e.message || e).replace(/https?:\/\/\S+/g, '[url]').slice(0, 160);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(out);
}

const ROUTES = {
  health: ['GET', health],
  mint: ['GET', mint],
  config: ['GET', config],
  save: ['POST', save],
  search: ['POST', search],
  'upload-start': ['POST', uploadStart],
  artwork: ['POST', artwork],
  chunk: ['POST', chunk],
  submit: ['POST', submit],
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const route = ROUTES[String(req.query?.action || '')];
  if (!route) return res.status(404).json({ error: 'Unknown action.' });
  if (req.method !== route[0]) return res.status(405).json({ error: `${route[0]} only.` });
  try {
    return await route[1](req, res);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[release]', req.query.action, e.message);
    return res.status(status).json({ error: status >= 500 && !e.status ? 'Server error. Your draft is safe: try again in a minute.' : e.message, ...(e.extra || {}) });
  }
}
