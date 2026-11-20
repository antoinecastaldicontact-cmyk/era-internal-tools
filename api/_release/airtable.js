// Airtable access for the release form — base « Catalog - Artist & Releases Base ».
//
// Env vars (Vercel):
//   AIRTABLE_TOKEN           - Personal Access Token with data.records:read + write on this base.
//   RELEASE_AIRTABLE_BASE_ID - optional, defaults to app4ItnNtOLDhF5df.
//
// Writes go by field ID, never by name: names change, IDs do not.

export const BASE_ID = process.env.RELEASE_AIRTABLE_BASE_ID || 'app4ItnNtOLDhF5df';

export const T = {
  tracks: 'tblh670kK1Fy8fWu5',   // Master Catalog (Meta) — one record per track
  artists: 'tblglW6hgMvXWlOzN',  // Artist Table
  people: 'tblssn3E0DmCGK5W9',   // Ayants Droits
};

export const F = {
  track: {
    name: 'fld57A0ASnqK6Vdbw',            // Product Name « Artist - Title »
    releaseDate: 'fld1RLU3jqbIM1hn4',     // B - Release Date
    releaseType: 'fldUfmcRPezLosnDn',     // « Single » (trailing space in Airtable) / « EP »
    mainArtist: 'fldGJ75xJJjMTOK2E',
    secondaryArtist: 'fldsCI3jj2if22ZK7',
    rightholders: 'fld2O8FZZQZ1iEZlg',    // A - Ayants Droits
    artwork: 'fld6V7ZpEq2EM7n39',         // B - Attachements (Artwork First)
    mastering: 'fldtiqnBUJ7bXV1Bj',
    composersText: 'fldu01P52G2e61QwV',   // Composers (;) — legacy text, kept in sync
    producersText: 'fldGsJzURjqO3N48V',   // Producers — legacy text
    extraMeta: 'fldKiWDYk3UtujYZQ',       // Extra Metadatas?
    gdriveFolderId: 'fldeaVb0jBndSdepb',
    splitMaster: 'fldg5qRymMUP9NulO',     // Split Sheet (Master) Artist — legacy text
    splitEdition: 'fldRkmWdytHrtNMVE',    // C - Split Sheet (Edition) - One Line — legacy text
    artistPitch: 'fldFLnwUtdTlklVGj',
    lyrics: 'fldJ9PyXmyKnHqTLO',
    isrc: 'fldK3p6heSKOEUxgs',
    pipeline: 'fldIEkg4oFR8oTVpo',
    formLink: 'fldxnCsLe4J33acrR',
    formProgress: 'fld8MKAS687mNwniO',
    formLastSaved: 'fld7fyOO8BfaC8vbZ',
    formSubmittedAt: 'fldEQ1vbNQKNzb8gB',
    formData: 'flddkYNKwHb6ueFbk',
    formContactEmail: 'fldH44IpgnTHTn9Lx',
    correctionNote: 'fldiwCwOuORbbFW6a',
    qcFlags: 'fldFygbf01AKmNTTu',
    version: 'fldKeNjH6FweCIkpI',
    genre: 'fldsDY3UJHW4h8BL1',
    language: 'fldcQ3x3X1DsO6bVh',
    explicit: 'fldt0sKuHdra4NI8E',
    bpm: 'fld9Uiwc5aXsRKtG8',
    key: 'fldBvJHhIpKEYqPMg',
    previewStart: 'fldsCHFPRi0iQjk09',
    driveFolder: 'fldX2tSCyPWLh50xz',
    composers: 'fldlYD7QDzUd8qp5e',
    lyricists: 'fldzPqUNqPCvDlfcG',
    producers: 'fldyy61HzunmgzJks',
    mixEngineer: 'fld6RtlapvLbkc4Gy',
    promoLinks: 'fld9Qf264WkDzzBVW',
  },
  artist: {
    name: 'fldL2cFC2wBD0y3R6',            // Brand Name
    photos: 'fldMDMkHbOxaHPGNz',          // Photos Détourées
    rightholders: 'fldogiRhwGhchs5is',    // Ayant Droits
    instagram: 'fldob8ZpsXOL1mkun',       // rich text
    tiktok: 'fld6NZCUkUFmArvp4',          // rich text
    spotifyId: 'fldZAGb0hP47U1ckG',       // Spotify ID (link or ID, long text)
    apple: 'fldb3GXtUIgXXnzj3',           // Apple Music (url)
    youtube: 'fldjUm1oiowcmb9Rl',         // YouTube (url)
    soundcloud: 'fldgy0xgXgcpp6Jn3',      // SoundCloud (url)
    bio: 'fld5ZmhazZseYYYGK',             // Bio Projet
    presskit: 'fld1vu4VoMzWJaRP1',        // Presskit (attachments)
    ficheStatus: 'fldOuPEdFcc7Ewy0X',
  },
  person: {
    name: 'fldq0I1SaSUlFkB4L',            // Real Name or Payee Name
    nationality: 'fld7wJQS7tjWNrazn',
    email: 'fldBSUwEWxVf5AdbW',           // Email - Contact
    address: 'fldgm5kR3H4MJg2RN',         // Adresse (rich text)
    proName: 'flduPKfSPiwWs13qw',
    anyPublishers: 'fldgqfv65hjI7tfPH',
    ipi: 'fldUzC9WmpCCZQCrg',
    notes: 'flda5WbCO4edddIib',
    phone: 'fldzYx12stbckWsOO',           // Whatsapp?
    alias: 'fld6jXv84TjX0MPdH',
    publishersInfo: 'fldUJ9kgKqVkmHtjr',
    ficheStatus: 'fldmiKjHLBsrxeGLb',
  },
};

// filterByFormula reads field NAMES: kept in one place.
export const FN = {
  artistName: '{Brand Name}',
  personName: '{Real Name or Payee Name}',
  personEmail: '{Email - Contact}',
};

export const PIPELINE = {
  toSend: 'Lien à envoyer',
  sent: 'Lien envoyé',
  draft: 'Brouillon',
  submitted: 'Soumis',
  correction: 'Correction demandée',
  qcOk: 'QC validé',
};
// Once submitted, the artist reads but cannot edit, until ERA asks for a correction.
export const LOCKED = ['Soumis', 'QC validé', 'Contrat envoyé', 'Signé', 'Livré'];

export const RELEASE_TYPE = { Single: 'Single ', EP: 'EP' };   // exact Airtable option names
export const PUBLISHER_CHOICE = { yes: 'Yes, i have one or more publishers', no: "No, i don't have any publisher" };

function token() {
  const t = process.env.RELEASE_AIRTABLE_TOKEN || process.env.AIRTABLE_TOKEN;
  if (!t) throw new Error('AIRTABLE_TOKEN missing in Vercel environment variables.');
  return t;
}

async function call(method, path, body) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d?.error?.message || d?.error?.type || d?.error || r.statusText;
    throw new Error(`[Airtable ${r.status}] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return d;
}

// Escapes a value for a double-quoted Airtable formula string.
export function q(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export async function find(table, formula, { maxRecords = 10, fields } = {}) {
  const params = new URLSearchParams({ filterByFormula: formula, maxRecords: String(maxRecords), pageSize: String(Math.min(100, maxRecords)), returnFieldsByFieldId: 'true' });
  if (fields) fields.forEach(f => params.append('fields[]', f));
  const d = await call('GET', `${table}?${params}`);
  return d.records || [];
}

export async function get(table, id) {
  return call('GET', `${table}/${id}?returnFieldsByFieldId=true`);
}

export async function create(table, fields) {
  const d = await call('POST', table, { records: [{ fields }], returnFieldsByFieldId: true, typecast: true });
  return d.records[0];
}

export async function update(table, id, fields) {
  const d = await call('PATCH', table, { records: [{ id, fields }], returnFieldsByFieldId: true, typecast: true });
  return d.records[0];
}

// Direct attachment upload (<= 5 MB, Airtable API limit).
export async function uploadAttachment(recordId, fieldId, { contentType, filename, base64 }) {
  const r = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${recordId}/${fieldId}/uploadAttachment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType, filename, file: base64 }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`[Airtable upload ${r.status}] ${d?.error?.message || r.statusText}`);
  }
  return r.json();
}

export const recordUrl = (table, id) => `https://airtable.com/${BASE_ID}/${table}/${id}`;
