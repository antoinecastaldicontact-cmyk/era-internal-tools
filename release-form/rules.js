// Release form rules, shared by the page (browser) and /api/release (server).
// One source of truth: what is required, what counts as complete, and the option lists.
// Plain ES module, no dependencies.

export const STEPS = ['welcome', 'release', 'audio', 'credits', 'rights', 'promo', 'review'];

export const STEP_LABELS = {
  welcome: 'Start',
  release: 'Release',
  audio: 'Audio & artwork',
  credits: 'Credits',
  rights: 'Rightholders & splits',
  promo: 'Pitch & promo',
  review: 'Review & submit',
};

export const GENRES = ['Afro House', 'Afrobeats', 'Dance', 'Deep House', 'Downtempo', 'Electronic', 'House',
  'Indie Dance', 'Melodic House & Techno', 'Organic House', 'Pop', 'Progressive House', 'Tech House', 'Other'];

export const LANGUAGES = ['English', 'French', 'Spanish', 'Portuguese', 'Italian', 'German',
  'Multiple languages', 'Instrumental', 'Other'];

// Exact option names of the Airtable « Mastering » single select.
export const MASTERING = ['Artist-Made', '@MasteredByEdouard - Edouard Carbonne', '@Translab - Benjamin Savignoni',
  '@ChabMastering', '@Julio Rodriguez Sanchez - Sandbay Studios'];

// Airtable « Nationality » options (value) and what the artist sees (label).
export const NATIONALITIES = [
  ['FR', 'France'], ['BE', 'Belgium'], ['NL', 'Netherlands'], ['GE', 'Germany'], ['SWE', 'Sweden'],
  ['UK', 'United Kingdom'], ['USA', 'United States'], ['MX', 'Mexico'], ['Other', 'Other'],
];

export const VERSIONS = ['Original Mix', 'Extended Mix', 'Radio Edit', 'Remix', 'Acoustic', 'VIP', 'Instrumental'];

export const FILE_KINDS = {
  master: { label: 'Master WAV', prefix: 'MASTER' },
  version: { label: 'Other version WAV', prefix: 'VERSION' },
  artwork: { label: 'Artwork', prefix: 'ARTWORK' },
  photo: { label: 'Artist photo', prefix: 'PHOTO' },
  promo: { label: 'Promo content', prefix: 'PROMO' },
};

export const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB per file
export const MAX_FILES = 60;

const str = (v) => String(v ?? '').trim();
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(str(v));
const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

export function emptyData() {
  return {
    v: 1,
    release: {
      title: '', version: 'Original Mix', type: 'Single', epTitle: '', genre: '', language: '',
      explicit: '', bpm: '', key: '', previewStart: '', mainArtists: [], featuredArtists: [],
    },
    files: [],
    lyrics: '',
    credits: { composers: [], lyricists: [], producers: [], mix: '', mastering: '', masteringOther: '', other: '' },
    people: {},
    rightholders: [],
    publishing: { applicable: '', rows: [] },
    pitch: { story: '', mood: '', references: '', supports: '', markets: '' },
    promoLinks: '',
    contact: { name: '', email: '' },
    confirm: false,
  };
}

export function isInstrumental(data) {
  return data?.release?.language === 'Instrumental';
}

// What a rightholder must have on file for the contract ({{CompoundInfos}}): legal name,
// full postal address, email. Nationality feeds the base. PRO / publisher are optional.
export function personMissing(p) {
  const miss = [];
  if (!p) return ['details'];
  if (p.existing) {
    // Person already in ERA's base: only what the server reported missing, unless now provided.
    for (const k of p.missing || []) {
      if (k === 'email' && !isEmail(p.email)) miss.push('email');
      if (k === 'address' && !(str(p.street) && str(p.postcode) && str(p.city) && str(p.country))) miss.push('postal address');
      if (k === 'nationality' && !str(p.nationality)) miss.push('nationality');
    }
    return miss;
  }
  if (!str(p.legalName)) miss.push('legal name');
  if (!isEmail(p.email)) miss.push('email');
  if (!(str(p.street) && str(p.postcode) && str(p.city) && str(p.country))) miss.push('postal address');
  if (!str(p.nationality)) miss.push('nationality');
  if (p.pro === 'yes' && !str(p.proName)) miss.push('PRO name');
  if (p.publisher === 'yes' && !str(p.publisherInfo)) miss.push('publisher details');
  return miss;
}

export function personName(p) {
  if (!p) return '';
  return str(p.legalName) || str(p.displayName) || str(p.alias) || '';
}

export function sharesTotal(rows) {
  return Math.round((rows || []).reduce((s, r) => s + (Number.isFinite(num(r.share)) ? num(r.share) : 0), 0) * 100) / 100;
}

// Returns { missing: [{ step, label }], warnings: [{ step, label }], progress: 0..100 }.
// ctx: { photosOnFile: boolean } — the main artist already has photos in ERA's base.
export function validate(data, ctx = {}) {
  const d = data || emptyData();
  const r = d.release || {};
  const missing = [];
  const warnings = [];
  let total = 0;
  let failed = 0;
  const need = (ok, step, label) => { total += 1; if (!ok) { failed += 1; missing.push({ step, label }); } };

  // Release
  need(str(r.title), 'release', 'Track title');
  need(str(r.version), 'release', 'Version');
  need((r.mainArtists || []).length > 0, 'release', 'Main artist');
  need(str(r.genre), 'release', 'Genre');
  need(str(r.language), 'release', 'Language');
  need(r.explicit === 'yes' || r.explicit === 'no', 'release', 'Explicit content: yes or no');
  if (r.type === 'EP') need(str(r.epTitle), 'release', 'EP title');
  if (/\b(feat\.?|ft\.?|featuring)\b/i.test(str(r.title))) {
    warnings.push({ step: 'release', label: 'The title contains "feat.": add featured artists in the Featured field, not in the title' });
  }
  if (str(r.bpm) && !(num(r.bpm) >= 40 && num(r.bpm) <= 250)) warnings.push({ step: 'release', label: 'BPM looks wrong' });

  // Audio & artwork
  const files = d.files || [];
  const done = (k) => files.filter(f => f.kind === k && f.status === 'done');
  need(done('master').length === 1, 'audio', 'Master WAV (one file)');
  need(done('artwork').length >= 1, 'audio', 'Artwork');
  if (!isInstrumental(d)) need(str(d.lyrics).length >= 20, 'audio', 'Lyrics');
  for (const f of files) {
    if (f.status !== 'done') missing.push({ step: 'audio', label: `Upload not finished: ${f.name}` });
  }
  if (str(r.previewStart) && !/^\d{1,2}:\d{2}$/.test(str(r.previewStart))) {
    missing.push({ step: 'audio', label: 'Preview start: use mm:ss' });
  }
  for (const f of done('version')) {
    if (!str(f.label)) missing.push({ step: 'audio', label: `Name the version for ${f.name}` });
  }

  // Credits
  const c = d.credits || {};
  need((c.composers || []).length > 0, 'credits', 'Composers');
  if (!isInstrumental(d)) need((c.lyricists || []).length > 0, 'credits', 'Lyricists');
  need((c.producers || []).length > 0, 'credits', 'Producers');
  need(str(c.mastering), 'credits', 'Mastering');
  if (c.mastering === 'Other') need(str(c.masteringOther), 'credits', 'Mastering engineer name');

  // Rightholders & splits (artist side of the master royalties, total 100 %)
  const people = d.people || {};
  const rh = d.rightholders || [];
  need(rh.length > 0, 'rights', 'At least one rightholder');
  if (rh.length) {
    const t = sharesTotal(rh);
    need(Math.abs(t - 100) < 0.01, 'rights', `Master split must total 100 % (now ${t} %)`);
    for (const row of rh) {
      const p = people[row.key];
      const miss = personMissing(p);
      if (miss.length) missing.push({ step: 'rights', label: `${personName(p) || 'Rightholder'}: ${miss.join(', ')}` });
      if (!(num(row.share) > 0)) missing.push({ step: 'rights', label: `${personName(p) || 'Rightholder'}: share above 0 %` });
    }
  }
  const pub = d.publishing || {};
  need(pub.applicable === 'yes' || pub.applicable === 'no', 'rights', 'Publishing split: yes or no');
  if (pub.applicable === 'yes') {
    const rows = pub.rows || [];
    const t = sharesTotal(rows);
    need(rows.length > 0 && Math.abs(t - 100) < 0.01, 'rights', `Publishing split must total 100 % (now ${t} %)`);
    const inPub = new Set(rows.map(x => x.key));
    for (const k of c.composers || []) {
      if (!inPub.has(k)) warnings.push({ step: 'rights', label: `${personName(people[k])} is credited as composer but has no publishing share` });
    }
  }

  // Pitch & promo
  const pt = d.pitch || {};
  need(str(pt.story).length >= 150, 'promo', 'The story of the track (150 characters minimum)');
  need(str(pt.mood), 'promo', 'Mood and emotion');
  if (!ctx.photosOnFile) need(done('photo').length >= 1, 'promo', 'At least one artist photo');
  need(str(d.contact?.name), 'promo', 'Your name');
  need(isEmail(d.contact?.email), 'promo', 'Your email');

  // Review
  need(d.confirm === true, 'review', 'Final confirmation');

  // Progress counts the required items only; per-person details and uploads in flight still block
  // the final submit (they are in `missing`) but do not move the bar.
  const progress = total ? Math.round(((total - failed) / total) * 100) : 0;
  return { missing, warnings, progress: missing.length ? Math.min(progress, 99) : 100 };
}

// Small, safe sanitiser applied by the server before storing a draft.
export function clampData(data) {
  const s = JSON.stringify(data ?? {});
  if (s.length > 95_000) throw Object.assign(new Error('Form data too large.'), { status: 413 });
  return JSON.parse(s);
}
