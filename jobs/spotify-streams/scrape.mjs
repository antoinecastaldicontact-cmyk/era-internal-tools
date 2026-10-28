// jobs/spotify-streams/scrape.mjs
//
// Relevé quotidien des streams Spotify (playcount public) → Airtable, table Songs.
// Remplace l'acteur Apify. Tourne dans GitHub Actions (cron), pas sur Vercel.
//
// Règle cardinale : ne jamais écrire un nombre qu'on n'a pas lu.
//   - playcount illisible  → rien n'est écrit pour ce titre, il sort en échec.
//   - pas de ligne J-2     → total_streams écrit, daily_streams laissé vide.
//   - total en baisse      → total_streams écrit, daily_streams laissé vide, signalé.
//
// Convention de date (identique à l'ancien pipeline Apify) : un relevé fait le jour J
// est écrit sur la ligne Date = J-1 (heure de Paris). daily_streams = total(J-1) - total(J-2).
//
// Env :
//   AIRTABLE_TOKEN  (obligatoire) — PAT Airtable, scope data.records:read/write sur la base
//   ORIGINS         (optionnel)   — valeurs du champ Origin de la Matrice, séparées par des virgules. Défaut : ERA
//   DRY_RUN         (optionnel)   — "1" pour lire sans écrire dans Airtable

import { chromium } from 'playwright';
import { appendFileSync } from 'node:fs';

const BASE = 'appnSgCIW2ik08BFm';
const T_MATRICE = 'tblG3ukbsQvGIFAmV';
const T_SONGS = 'tblUwVghKKSOxA7D4';

// IDs de champs (stables), noms utilisés uniquement dans les formules de filtre.
const F = {
  m_songName: 'fld7lVzjTgaPkMig0',
  m_spotifyId: 'fldccJKzMUzN8OpqM',
  m_origin: 'fldKtqvMPWLFwfvPo',
  s_date: 'fldf9MptUkw1vIiMK',
  s_trackName: 'fldYT0C8R2wov1jtX',
  s_total: 'fldnOyyEQOg0v3jQT',
  s_daily: 'fldlCSBIbGbJeAdDA',
  s_link: 'fldGU5mCZabE7BlUh',
};

const TOKEN = process.env.AIRTABLE_TOKEN;
const ORIGINS = (process.env.ORIGINS || 'ERA').split(',').map(s => s.trim()).filter(Boolean);
const DRY_RUN = process.env.DRY_RUN === '1';

if (!TOKEN) {
  console.error('AIRTABLE_TOKEN manquant.');
  process.exit(2);
}

// ---------- dates (Europe/Paris) ----------
function parisToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function shiftDay(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const TODAY = parisToday();
const TARGET = shiftDay(TODAY, -1); // ligne écrite
const PREV = shiftDay(TODAY, -2);   // ligne de référence pour le delta

// ---------- Airtable ----------
async function at(method, path, body) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`https://api.airtable.com/v0/${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429) { await sleep(1500 * attempt); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Airtable ${method} ${path.split('?')[0]} → ${r.status} ${JSON.stringify(j.error || j)}`);
    return j;
  }
  throw new Error('Airtable : rate limit persistant');
}

async function listAll(table, { formula, fields }) {
  const out = [];
  let offset;
  do {
    const p = new URLSearchParams({ returnFieldsByFieldId: 'true', pageSize: '100' });
    if (formula) p.set('filterByFormula', formula);
    for (const f of fields) p.append('fields[]', f);
    if (offset) p.set('offset', offset);
    const j = await at('GET', `${BASE}/${table}?${p}`);
    out.push(...j.records);
    offset = j.offset;
  } while (offset);
  return out;
}

async function writeBatches(method, records) {
  for (let i = 0; i < records.length; i += 10) {
    await at(method, `${BASE}/${T_SONGS}`, { records: records.slice(i, i + 10), typecast: true });
    await sleep(250);
  }
}

// ---------- Spotify ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseCount(text) {
  if (text == null) return null;
  const t = String(text).trim();
  if (!t || t.includes('<')) return null;                 // "< 1 000" : pas de chiffre exact
  if (!/^[\d\s,.  ]+$/.test(t)) return null;      // autre chose qu'un nombre formaté
  const digits = t.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

async function readPlaycount(context, spotifyId) {
  const page = await context.newPage();
  let apiCount = null;
  page.on('response', async resp => {
    if (!resp.url().includes('pathfinder')) return;
    try {
      const j = await resp.json();
      const tu = j && j.data && j.data.trackUnion;
      if (tu && tu.playcount != null && (tu.id === spotifyId || String(tu.uri || '').endsWith(spotifyId))) {
        apiCount = parseCount(tu.playcount);
      }
    } catch { /* réponse non JSON */ }
  });
  try {
    await page.goto(`https://open.spotify.com/track/${spotifyId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const el = page.locator('[data-testid="playcount"]').first();
    await el.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
    const domText = await el.textContent({ timeout: 3000 }).catch(() => null);
    const domCount = parseCount(domText);
    if (apiCount == null) await sleep(500);
    const value = apiCount ?? domCount;
    return {
      value,
      source: apiCount != null ? 'api' : domCount != null ? 'dom' : null,
      mismatch: apiCount != null && domCount != null && apiCount !== domCount,
      raw: domText,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- run ----------
async function main() {
  console.log(`Relevé du ${TODAY} → ligne Songs du ${TARGET} (delta vs ${PREV}). Origins: ${ORIGINS.join(', ')}${DRY_RUN ? ' — DRY RUN' : ''}`);

  const originFormula = `OR(${ORIGINS.map(o => `{Origin}='${o.replace(/'/g, "\\'")}'`).join(',')})`;
  const tracks = (await listAll(T_MATRICE, {
    formula: `AND(${originFormula}, {spotify_id}!='')`,
    fields: [F.m_songName, F.m_spotifyId, F.m_origin],
  })).map(r => ({
    matriceId: r.id,
    name: (r.fields[F.m_songName] || '').trim(),
    spotifyId: (r.fields[F.m_spotifyId] || '').trim(),
  })).filter(t => /^[A-Za-z0-9]{22}$/.test(t.spotifyId));

  console.log(`${tracks.length} titres à relever.`);

  const songs = await listAll(T_SONGS, {
    formula: `OR(DATETIME_FORMAT({Date},'YYYY-MM-DD')='${TARGET}', DATETIME_FORMAT({Date},'YYYY-MM-DD')='${PREV}')`,
    fields: [F.s_date, F.s_total, F.s_link],
  });
  const rowsTarget = new Map(); // matriceId -> songs record id
  const totalsPrev = new Map(); // matriceId -> total_streams J-2
  for (const r of songs) {
    const link = (r.fields[F.s_link] || [])[0];
    if (!link) continue;
    const d = r.fields[F.s_date];
    if (d === TARGET) rowsTarget.set(link, r.id);
    if (d === PREV && typeof r.fields[F.s_total] === 'number') totalsPrev.set(link, r.fields[F.s_total]);
  }

  const browser = await chromium.launch({ headless: true });
  // UA d'un Chrome de bureau ordinaire (le UA headless par défaut contient "HeadlessChrome").
  const major = String(browser.version()).split('.')[0];
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  const context = await browser.newContext({ locale: 'en-US', userAgent: ua, viewport: { width: 1280, height: 900 } });

  const results = [];
  for (const t of tracks) {
    let read = null;
    for (let attempt = 1; attempt <= 2 && (!read || read.value == null); attempt++) {
      try { read = await readPlaycount(context, t.spotifyId); }
      catch (e) { read = { value: null, error: String(e.message || e) }; }
      if (read.value == null && attempt === 1) await sleep(2000);
    }

    const res = { ...t, total: read.value, source: read.source, raw: read.raw, error: read.error, daily: null, status: '' };
    if (res.total == null) {
      res.status = 'échec lecture';
    } else {
      const prev = totalsPrev.get(t.matriceId);
      if (prev == null) res.status = 'total seul (pas de J-2)';
      else if (res.total < prev) res.status = `ANOMALIE : total en baisse (${prev} → ${res.total})`;
      else { res.daily = res.total - prev; res.status = 'ok'; }
      if (read.mismatch) res.status += ' — écart API/page';
    }
    results.push(res);
    console.log(`${res.status.padEnd(28)} ${String(res.total ?? '—').padStart(12)} ${String(res.daily ?? '').padStart(9)}  ${t.name}`);
    await sleep(800);
  }
  await browser.close();

  // ---------- écriture ----------
  const creates = [];
  const updates = [];
  for (const r of results) {
    if (r.total == null) continue;
    const fields = { [F.s_total]: r.total };
    if (r.daily != null) fields[F.s_daily] = r.daily;
    const existing = rowsTarget.get(r.matriceId);
    if (existing) updates.push({ id: existing, fields });
    else creates.push({ fields: { ...fields, [F.s_date]: TARGET, [F.s_trackName]: r.name, [F.s_link]: [r.matriceId] } });
  }
  if (DRY_RUN) {
    console.log(`DRY RUN — ${creates.length} créations et ${updates.length} mises à jour non écrites.`);
  } else {
    await writeBatches('POST', creates);
    await writeBatches('PATCH', updates);
    console.log(`Écrit : ${creates.length} lignes créées, ${updates.length} mises à jour.`);
  }

  // ---------- résumé ----------
  const failed = results.filter(r => r.total == null);
  const anomalies = results.filter(r => r.status.startsWith('ANOMALIE'));
  const lines = [
    `## Streams Spotify — ligne du ${TARGET}${DRY_RUN ? ' (dry run)' : ''}`,
    '',
    `${results.length} titres · ${results.length - failed.length} lus · ${failed.length} échecs · ${anomalies.length} anomalies`,
    '',
    '| Titre | total_streams | daily_streams | Statut |',
    '|---|---:|---:|---|',
    ...results.map(r => `| ${r.name} | ${r.total ?? '—'} | ${r.daily ?? ''} | ${r.status}${r.error ? ` (${r.error.slice(0, 80)})` : ''} |`),
  ];
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');

  // Un run avec des échecs sort en erreur : GitHub notifie par mail, le trou ne passe pas inaperçu.
  if (failed.length || anomalies.length) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
