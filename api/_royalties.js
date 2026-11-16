// Shared data layer for the royalties cockpit (not routed: underscore prefix).
// Reads the base « ERA Reporting & Royalties » server-side with AIRTABLE_TOKEN.
// Field IDs, not names, so a renamed column never breaks the cockpit.
//
// Env vars (Vercel):
//   AIRTABLE_TOKEN       — read access to appBvSWFIA6P36nXu (data.records:read)
//   ROYALTIES_ADMIN_KEY  — long secret: admin access + signature of artist links

import crypto from 'crypto';

export const BASE = 'appBvSWFIA6P36nXu';

const T = {
  projects: 'tblEhWQUHJG1s382P',
  lines: 'tblgDfc7fJIZpyRn1',
  expenses: 'tblJXhykALW0OhiG2',
  splits: 'tbl4fOyXRosB9FWFr',
  payees: 'tblC4Imr028vyTf8l',
};

const F = {
  p: {
    title: 'fldtbHjf9mj6GAKBv', release: 'fldVamgGBYGHtoiL7', labelCut: 'fldxNV6VTwRw0VfUb',
    splitsSince: 'fldV5EAhaL22M6YjH', notes: 'fld5wTXTLoWLxRjZq', splits: 'fld5i87siBmgg0qZn',
    status: 'fldw3Ggw3eWMBQMCD', distributor: 'fldebR6ErjD7QTSME', gross: 'fldZTnPTzcgvIE1ZQ',
    marketing: 'fldCsMAYQdNN0wl7v', artistCosts: 'fldV5tLe0PpL7974R', toVerify: 'fldGDSMb1fQFCmuik',
    remaining: 'fldYO2LnzIbwW5k6i', months: 'fldlr7IvA6K6SN5fI', dealType: 'fldYjwCXX9Uu3gbVz',
    splitStatus: 'fldQjydY4pf1gqMII', streams: 'fldW0LOKjEjDBJ1yj', kind: 'fldKT8Lsk6gkOtYZl',
  },
  l: {
    project: 'fldBztldhipxySrdN', usage: 'fldgMHZdqxzrpdjAR', streams: 'fldpr7pV8lKnAK1NA',
    ugc: 'fld79S7rDUqwojV03', gross: 'fldETeVjw0eMKy9Ca', source: 'fldUb9rmvAYcoo5ZP',
  },
  e: {
    name: 'fldfAjZX4kEJdCXtP', amount: 'fldegUFqJdKso0OuY', date: 'fldoLBEcCKTn3kQrR',
    month: 'fldtHPies9KUDbFCw', type: 'fld6ygk8iGzoYVoPk', source: 'fldPHbK9sRaQ18DD7',
    project: 'fldGlc8gFgtgdOygn', bucket: 'fldHCKGpfc0MPPwFQ', toVerify: 'fldtgBzJltRAS0QIO',
    notes: 'fldlYVG7ndqgPhwqC',
  },
  s: { share: 'fldxtVyfxX5bAwTFW', source: 'fld7MmQ7Uxuz6ImQK', project: 'fldtlO6vgWN1XSX5U', payee: 'fldY6miy1xVnUo4Ik' },
  y: { name: 'fldUrvSKgOVv3gyou' },
};

const MARKETING = 'Marketing (from gross)';
const ARTIST = 'Artist account (from artist share)';

// ---------- Airtable ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listAll(token, table, fields) {
  const out = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${table}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('returnFieldsByFieldId', 'true');
    for (const f of fields) url.searchParams.append('fields[]', f);
    if (offset) url.searchParams.set('offset', offset);
    let r;
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status !== 429) break;
      await sleep(1100 * (attempt + 1));
    }
    if (!r.ok) {
      const err = new Error(`airtable_${r.status}`);
      err.status = r.status;
      throw err;
    }
    const d = await r.json();
    out.push(...d.records);
    offset = d.offset;
  } while (offset);
  return out;
}

export async function fetchRaw(token) {
  const [projects, lines, expenses, splits, payees] = await Promise.all([
    listAll(token, T.projects, Object.values(F.p)),
    listAll(token, T.lines, Object.values(F.l)),
    listAll(token, T.expenses, Object.values(F.e)),
    listAll(token, T.splits, Object.values(F.s)),
    listAll(token, T.payees, Object.values(F.y)),
  ]);
  return { projects, lines, expenses, splits, payees };
}

export async function ping(token) {
  const url = new URL(`https://api.airtable.com/v0/${BASE}/${T.projects}`);
  url.searchParams.set('pageSize', '1');
  url.searchParams.append('fields[]', F.p.title);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return r.status;
}

// Warm-instance cache: the base changes once a month (the 15th).
let CACHE = { at: 0, data: null };
const TTL = 10 * 60 * 1000;

export async function getModel(token, { refresh = false } = {}) {
  if (!refresh && CACHE.data && Date.now() - CACHE.at < TTL) return CACHE.data;
  const raw = await fetchRaw(token);
  const data = buildModel(raw);
  CACHE = { at: Date.now(), data };
  return data;
}

// ---------- Model ----------

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const one = (v) => (Array.isArray(v) ? v[0] : v);
const sel = (v) => (v && typeof v === 'object' ? v.name : v) || null;
const ym = (v) => (typeof v === 'string' && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null);

function monthRange(a, b) {
  const out = [];
  let [y, m] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  while (y < by || (y === by && m <= bm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m === 13) { m = 1; y += 1; }
  }
  return out;
}

export function buildModel(raw) {
  const payeeName = new Map(raw.payees.map((p) => [p.id, p.fields[F.y.name] || '']));

  const P = new Map();
  for (const rec of raw.projects) {
    const f = rec.fields;
    P.set(rec.id, {
      id: rec.id,
      title: f[F.p.title] || '(sans titre)',
      release: f[F.p.release] || null,
      monthsSinceRelease: f[F.p.months] ?? null,
      labelCut: f[F.p.labelCut] ?? null,
      splitsSince: f[F.p.splitsSince] || null,
      notes: f[F.p.notes] || '',
      status: f[F.p.status] || 'No spend',
      distributor: (f[F.p.distributor] || []).map(sel),
      dealType: sel(f[F.p.dealType]),
      splitStatus: sel(f[F.p.splitStatus]),
      kind: sel(f[F.p.kind]),
      // Full precision here; rounding only on aggregates and in the UI
      // (summing rounded values drifts by a cent on 25 titles).
      gross: num(f[F.p.gross]),
      marketing: num(f[F.p.marketing]),
      artistCosts: num(f[F.p.artistCosts]),
      toVerify: num(f[F.p.toVerify]),
      remaining: num(f[F.p.remaining]),
      streams: Math.round(num(f[F.p.streams])),
      monthly: {}, // ym -> { gross, streams, ugc, marketing, artist }
      expenses: [],
      splits: [],
    });
  }

  const bucket = (p, m) => (p.monthly[m] ||= { gross: 0, streams: 0, ugc: 0, marketing: 0, artist: 0 });
  const months = new Set();
  // Reporting coverage: distributors report with different lags (Warner quarterly,
  // Wiseband monthly). Months after the earliest « last month » are incomplete.
  const lastBySource = {};

  for (const rec of raw.lines) {
    const f = rec.fields;
    const p = P.get(one(f[F.l.project]));
    const m = ym(f[F.l.usage]);
    if (!p || !m) continue;
    const b = bucket(p, m);
    b.gross += num(f[F.l.gross]);
    b.streams += num(f[F.l.streams]);
    b.ugc += num(f[F.l.ugc]);
    months.add(m);
    const src = sel(f[F.l.source]) || 'Autre';
    if (!lastBySource[src] || m > lastBySource[src]) lastBySource[src] = m;
    (p.sources ||= new Set()).add(src);
  }

  for (const rec of raw.expenses) {
    const f = rec.fields;
    const p = P.get(one(f[F.e.project]));
    const m = ym(f[F.e.month]) || ym(f[F.e.date]);
    const amount = num(f[F.e.amount]);
    const bk = sel(f[F.e.bucket]);
    if (!p) continue;
    p.expenses.push({
      name: f[F.e.name] || '', month: m, amount, type: sel(f[F.e.type]),
      source: sel(f[F.e.source]), bucket: bk, toVerify: !!f[F.e.toVerify], notes: f[F.e.notes] || '',
    });
    if (!m) continue;
    if (bk === MARKETING) { bucket(p, m).marketing += amount; months.add(m); }
    else if (bk === ARTIST) { bucket(p, m).artist += amount; months.add(m); }
  }

  for (const rec of raw.splits) {
    const f = rec.fields;
    const p = P.get(one(f[F.s.project]));
    if (!p) continue;
    p.splits.push({
      payee: payeeName.get(one(f[F.s.payee])) || '', share: f[F.s.share] ?? null, source: sel(f[F.s.source]),
    });
  }

  const allMonths = [...months].sort();
  const axis = allMonths.length ? monthRange(allMonths[0], allMonths[allMonths.length - 1]) : [];

  const projects = [...P.values()];
  const checks = [];

  for (const p of projects) {
    let cg = 0, cm = 0, ca = 0;
    p.raw = []; // unrounded monthly values for the catalogue sums (dropped below)
    p.series = axis.map((m) => {
      const b = p.monthly[m] || { gross: 0, streams: 0, ugc: 0, marketing: 0, artist: 0 };
      cg += b.gross; cm += b.marketing;
      ca += b.artist;
      p.raw.push({ gross: b.gross, marketing: b.marketing, cumMarketing: cm, recovered: Math.min(cg, cm) });
      return {
        m, gross: r2(b.gross), streams: Math.round(b.streams), ugc: Math.round(b.ugc),
        marketing: r2(b.marketing), artist: r2(b.artist), cumGross: r2(cg), cumMarketing: r2(cm),
        recovered: r2(Math.min(cg, cm)),
      };
    });
    delete p.monthly;
    // Last month for which this project's distributor(s) have reported.
    const srcs = [...(p.sources || [])];
    p.dataUntil = srcs.length ? srcs.map((x) => lastBySource[x]).sort().pop() : null;
    p.sources = srcs;
    // Consistency against the Airtable rollups (the money source of truth).
    if (Math.abs(cg - p.gross) > 0.5) checks.push({ project: p.title, field: 'gross', lines: r2(cg), rollup: r2(p.gross) });
    if (Math.abs(cm - p.marketing) > 0.5) checks.push({ project: p.title, field: 'marketing', lines: r2(cm), rollup: r2(p.marketing) });
    if (Math.abs(ca - p.artistCosts) > 0.5) checks.push({ project: p.title, field: 'artistCosts', lines: r2(ca), rollup: r2(p.artistCosts) });
    p.recoupPct = p.marketing > 0 ? p.gross / p.marketing : null;
    p.expenses.sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }

  // Portfolio = projects with marketing (the recoupment test perimeter).
  const port = projects.filter((p) => p.marketing > 0);
  const sum = (arr, k) => r2(arr.reduce((s, x) => s + x[k], 0));
  const deployed = sum(port, 'marketing');
  const grossPort = sum(port, 'gross');
  const recovered = r2(port.reduce((s, p) => s + Math.min(p.gross, p.marketing), 0));
  const atRisk = r2(port.filter((p) => p.status !== 'Recouped').reduce((s, p) => s + p.remaining, 0));

  const catalogue = axis.map((m, i) => {
    let marketing = 0, grossP = 0, recov = 0, cumM = 0, gross = 0, streams = 0, ugc = 0;
    for (const p of projects) {
      const s = p.series[i], w = p.raw[i];
      gross += w.gross; streams += s.streams; ugc += s.ugc;
      if (p.marketing > 0) {
        marketing += w.marketing; grossP += w.gross; recov += w.recovered; cumM += w.cumMarketing;
      }
    }
    return {
      m, gross: r2(gross), streams, ugc, marketing: r2(marketing), grossPortfolio: r2(grossP),
      deployedCum: r2(cumM), recoveredCum: r2(recov),
    };
  });

  const lasts = Object.values(lastBySource).sort();
  const completeUntil = lasts.length ? lasts[0] : null;

  for (const p of projects) delete p.raw;

  return {
    generatedAt: new Date().toISOString(),
    months: axis,
    coverage: { bySource: lastBySource, completeUntil },
    kpis: {
      deployed, recovered, atRisk, grossPortfolio: grossPort,
      multiple: deployed > 0 ? grossPort / deployed : null,
      grossCatalogue: sum(projects, 'gross'),
      streamsCatalogue: projects.reduce((s, p) => s + p.streams, 0),
      portfolioCount: port.length,
      byStatus: ['Recouped', 'Maturing', 'Impaired', 'No spend'].map((st) => {
        const g = projects.filter((p) => p.status === st);
        return { status: st, count: g.length, marketing: sum(g, 'marketing'), gross: sum(g, 'gross'), remaining: sum(g, 'remaining') };
      }),
    },
    catalogue,
    projects,
    checks,
  };
}

// ---------- Artist view (one project, no internal notes, no other titles) ----------

export function artistView(model, id) {
  const p = model.projects.find((x) => x.id === id);
  if (!p) return null;
  return {
    generatedAt: model.generatedAt,
    title: p.title,
    release: p.release,
    status: p.status,
    splitStatus: p.splitStatus,
    distributor: p.distributor,
    gross: p.gross,
    marketing: p.marketing,
    remaining: p.remaining,
    recoupPct: p.recoupPct,
    streams: p.streams,
    dataUntil: p.dataUntil,
    artistShare: p.labelCut == null ? null : 1 - p.labelCut,
    splits: p.splits.map((s) => ({ payee: s.payee, share: s.share })),
    series: p.series.map((s) => ({
      m: s.m, gross: s.gross, streams: s.streams, marketing: s.marketing, cumGross: s.cumGross, cumMarketing: s.cumMarketing,
    })),
  };
}

// ---------- Auth helpers ----------

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function signArtist(secret, id) {
  return crypto.createHmac('sha256', secret).update(`artist:${id}`).digest('hex').slice(0, 32);
}
