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
  periods: 'tblyXfHinkiIzFewQ',
};

const F = {
  p: {
    title: 'fldtbHjf9mj6GAKBv', release: 'fldVamgGBYGHtoiL7', labelCut: 'fldxNV6VTwRw0VfUb',
    splitsSince: 'fldV5EAhaL22M6YjH', notes: 'fld5wTXTLoWLxRjZq', splits: 'fld5i87siBmgg0qZn',
    status: 'fldw3Ggw3eWMBQMCD', distributor: 'fldebR6ErjD7QTSME', gross: 'fldZTnPTzcgvIE1ZQ',
    marketing: 'fldCsMAYQdNN0wl7v', artistCosts: 'fldV5tLe0PpL7974R', toVerify: 'fldGDSMb1fQFCmuik',
    remaining: 'fldYO2LnzIbwW5k6i', months: 'fldlr7IvA6K6SN5fI', dealType: 'fldYjwCXX9Uu3gbVz',
    splitStatus: 'fldQjydY4pf1gqMII', streams: 'fldW0LOKjEjDBJ1yj', kind: 'fldKT8Lsk6gkOtYZl',
    fixed: 'fld3CfCk406SyU1Mt',
  },
  l: {
    project: 'fldBztldhipxySrdN', usage: 'fldgMHZdqxzrpdjAR', streams: 'fldpr7pV8lKnAK1NA',
    ugc: 'fld79S7rDUqwojV03', gross: 'fldETeVjw0eMKy9Ca', source: 'fldUb9rmvAYcoo5ZP',
    revenue: 'fldkhWoChGw3P6Sd0', payment: 'fldR56pMRu717n7bh', period: 'fldNwfijxiLgXA8xs',
  },
  e: {
    name: 'fldfAjZX4kEJdCXtP', amount: 'fldegUFqJdKso0OuY', date: 'fldoLBEcCKTn3kQrR',
    month: 'fldtHPies9KUDbFCw', type: 'fld6ygk8iGzoYVoPk', source: 'fldPHbK9sRaQ18DD7',
    project: 'fldGlc8gFgtgdOygn', bucket: 'fldHCKGpfc0MPPwFQ', toVerify: 'fldtgBzJltRAS0QIO',
    notes: 'fldlYVG7ndqgPhwqC',
  },
  s: { share: 'fldxtVyfxX5bAwTFW', source: 'fld7MmQ7Uxuz6ImQK', project: 'fldtlO6vgWN1XSX5U', payee: 'fldY6miy1xVnUo4Ik' },
  y: { name: 'fldUrvSKgOVv3gyou', email: 'fldMoLHfJUy9bUaJD' },
  per: { name: 'flde4PhoOljBRnT0j', received: 'fldSCMAMtwnY0twHy', csvTotal: 'fldwQu37tYZqHYIu8' },
};

// Structure costs covered by the margin of recouped titles (skill era-monthly-royalties, pocket A).
const STRUCTURE_COSTS = 3482;
// Wiseband: Spotify, Deezer and Qobuz land one month after the other stores, so the
// latest usage month of an export is always partial (skill rule 0.2).
const WISEBAND = 'Wiseband';
const MIN_DATA_MONTHS = 6; // verdict « Impaired » after 6 complete months of revenue

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
  const [projects, lines, expenses, splits, payees, periods] = await Promise.all([
    listAll(token, T.projects, Object.values(F.p)),
    listAll(token, T.lines, Object.values(F.l)),
    listAll(token, T.expenses, Object.values(F.e)),
    listAll(token, T.splits, Object.values(F.s)),
    listAll(token, T.payees, Object.values(F.y)),
    listAll(token, T.periods, Object.values(F.per)),
  ]);
  return { projects, lines, expenses, splits, payees, periods };
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
const minOf = (a) => (a.length ? [...a].sort()[0] : null);
const maxOf = (a) => (a.length ? [...a].sort().pop() : null);

export function ymAdd(m, k) {
  let [y, mo] = m.split('-').map(Number);
  mo += k;
  while (mo > 12) { mo -= 12; y += 1; }
  while (mo < 1) { mo += 12; y -= 1; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}
const monthsBetween = (a, b) => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};
function nowMonth() {
  try { return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 7); } catch (e) { return new Date().toISOString().slice(0, 7); }
}

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

const isAda = (src) => !!src && src.startsWith('Warner');
const ZERO = () => ({ gross: 0, revenue: 0, dues: 0, streams: 0, ugc: 0, marketing: 0, artist: 0, other: 0 });

// opts.now: 'YYYY-MM' to pin the current month (tests). Defaults to Europe/Paris today.
export function buildModel(raw, opts = {}) {
  const now = opts.now || nowMonth();
  const payeeName = new Map(raw.payees.map((p) => [p.id, p.fields[F.y.name] || '']));
  // Admin model only: artistView never carries emails.
  const payeeEmail = new Map(raw.payees.map((p) => [p.id, (p.fields[F.y.email] || '').trim()]));
  const periodName = new Map(raw.periods.map((r) => [r.id, r.fields[F.per.name] || '']));

  const P = new Map();
  for (const rec of raw.projects) {
    const f = rec.fields;
    const dealType = sel(f[F.p.dealType]);
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
      dealType,
      splitStatus: sel(f[F.p.splitStatus]),
      kind: sel(f[F.p.kind]),
      // Full precision here; rounding only on aggregates and in the UI
      // (summing rounded values drifts by a cent on 25 titles).
      gross: num(f[F.p.gross]),
      marketing: num(f[F.p.marketing]),
      artistCosts: num(f[F.p.artistCosts]),
      toVerify: num(f[F.p.toVerify]),
      remaining: num(f[F.p.remaining]),
      fixed: num(f[F.p.fixed]) > 0 ? num(f[F.p.fixed]) : null,
      streams: Math.round(num(f[F.p.streams])),
      // No artist royalty on a cover buyout: ERA keeps 100 %.
      buyout: !!dealType && dealType.startsWith('Cover buyout'),
      monthly: {}, // ym -> ZERO()
      expenses: [],
      splits: [],
    });
  }

  const bucket = (p, m) => (p.monthly[m] ||= ZERO());
  const months = new Set();
  const lastBySource = {};
  const unassigned = {}; // ym -> spend with no project (catalogue playlist campaigns)
  const byPeriod = new Map(); // period record id -> { revenue, gross, usage:Set }

  for (const rec of raw.lines) {
    const f = rec.fields;
    const m = ym(f[F.l.usage]);
    const g = num(f[F.l.gross]);
    const rev = num(f[F.l.revenue]);
    const p = P.get(one(f[F.l.project]));
    for (const pid of f[F.l.period] || []) {
      const a = byPeriod.get(pid) || { revenue: 0, gross: 0, usage: new Set(), projects: new Set() };
      a.revenue += rev; a.gross += g; if (m) a.usage.add(m);
      if (p) { a.projects.add(p.id); (p.periods ||= new Set()).add(periodName.get(pid) || pid); }
      byPeriod.set(pid, a);
    }
    if (!p || !m) continue;
    const src = sel(f[F.l.source]) || 'Autre';
    const b = bucket(p, m);
    b.gross += g;
    b.revenue += rev;
    b.streams += num(f[F.l.streams]);
    b.ugc += num(f[F.l.ugc]);
    // Royalties owed to the artist side on this line if the project is recouped
    // (skill era-monthly-royalties 5.0): Wiseband rows split at source are already net.
    if (p.buyout) b.dues += 0;
    else if (p.labelCut != null) b.dues += isAda(src) ? g * (1 - p.labelCut) : Math.max(rev - p.labelCut * g, 0);
    else b.duesUnknown = true;
    months.add(m);
    if (!lastBySource[src] || m > lastBySource[src]) lastBySource[src] = m;
    (p.sources ||= new Set()).add(src);
  }

  for (const rec of raw.expenses) {
    const f = rec.fields;
    const p = P.get(one(f[F.e.project]));
    const m = ym(f[F.e.month]) || ym(f[F.e.date]);
    const amount = num(f[F.e.amount]);
    const bk = sel(f[F.e.bucket]);
    if (!p) {
      if (m) { unassigned[m] = (unassigned[m] || 0) + amount; months.add(m); }
      continue;
    }
    p.expenses.push({
      name: f[F.e.name] || '', month: m, amount, type: sel(f[F.e.type]),
      source: sel(f[F.e.source]), bucket: bk, toVerify: !!f[F.e.toVerify], notes: f[F.e.notes] || '',
    });
    if (!m) continue;
    months.add(m);
    if (bk === MARKETING) bucket(p, m).marketing += amount;
    else if (bk === ARTIST) bucket(p, m).artist += amount;
    else bucket(p, m).other += amount;
  }

  for (const rec of raw.splits) {
    const f = rec.fields;
    const p = P.get(one(f[F.s.project]));
    if (!p) continue;
    const pid = one(f[F.s.payee]);
    p.splits.push({
      payee: payeeName.get(pid) || '', email: payeeEmail.get(pid) || '', share: f[F.s.share] ?? null, source: sel(f[F.s.source]),
    });
  }

  // ---- reporting coverage (the second speed) ----
  // Complete = every store reported. Wiseband's latest month lacks Spotify, Deezer, Qobuz.
  const completeBySource = {};
  for (const [src, last] of Object.entries(lastBySource)) completeBySource[src] = src === WISEBAND ? ymAdd(last, -1) : last;
  const completeUntil = minOf(Object.values(completeBySource));
  const partialUntil = maxOf(Object.values(lastBySource));
  const stateOf = (m) => (completeUntil && m <= completeUntil ? 'complete' : partialUntil && m <= partialUntil ? 'partial' : 'pending');
  // Wiseband statement of the 15th: month M partial at M+2, complete at M+3.
  const expected = (m) => ({ partial: `${ymAdd(m, 2)}-15`, complete: `${ymAdd(m, 3)}-15` });

  const allMonths = [...months].sort();
  const axis = allMonths.length ? monthRange(allMonths[0], maxOf([allMonths[allMonths.length - 1], now])) : [];

  const projects = [...P.values()];
  const checks = [];

  for (const p of projects) {
    let cg = 0, cm = 0, ca = 0, recouped = false;
    const invested = p.marketing > 0 || p.fixed != null;
    p.raw = []; // unrounded monthly values for the catalogue sums (dropped below)
    p.series = axis.map((m) => {
      const b = p.monthly[m] || ZERO();
      const wasRecouped = recouped;
      cg += b.gross; cm += b.marketing; ca += b.artist;
      const thr = p.fixed != null ? p.fixed : cm;
      // Pocket of this month: recouped at the start of the month, crossing during it,
      // still recouping, or catalogue without investment. Once recouped, always recouped:
      // ads after recoupment are a label cost, never re-recouped (skill rule 0.6).
      let pocket, frac = 0;
      if (!invested) pocket = 'nospend';
      else if (wasRecouped) { pocket = 'recouped'; frac = 1; }
      else if (thr > 0 && cg >= thr - 1e-9) {
        pocket = 'crossing'; recouped = true;
        if (!p.recoupedIn) p.recoupedIn = m;
        frac = b.gross > 0 ? Math.min(1, Math.max(0, (cg - thr) / b.gross)) : 0;
      } else pocket = 'recouping';
      p.raw.push({
        m, gross: b.gross, revenue: b.revenue, dues: b.dues, duesKnown: !b.duesUnknown, marketing: b.marketing,
        spend: b.marketing + b.artist + b.other, cumMarketing: cm, recovered: Math.min(cg, cm), pocket, frac,
        remainingEnd: invested && !recouped && (cg > 0 || cm > 0 || ca > 0) ? Math.max(thr - cg, 0) : 0,
      });
      return {
        m, gross: r2(b.gross), streams: Math.round(b.streams), ugc: Math.round(b.ugc),
        marketing: r2(b.marketing), artist: r2(b.artist), cumGross: r2(cg), cumMarketing: r2(cm),
        recovered: r2(Math.min(cg, cm)), state: stateOf(m),
      };
    });
    delete p.monthly;
    const srcs = [...(p.sources || [])];
    p.sources = srcs;
    p.periods = [...(p.periods || [])].sort();
    p.ugc = p.series.reduce((a, s) => a + s.ugc, 0);
    // Last month with any data, and last month with all stores reported, for this project.
    p.dataUntil = maxOf(srcs.map((x) => lastBySource[x]));
    p.completeThrough = minOf(srcs.map((x) => completeBySource[x]));
    // Age in months of complete revenue (royalties land 2 to 3 months after the streams).
    const rel = ym(p.release);
    p.dataAge = rel && p.completeThrough ? Math.max(0, monthsBetween(rel, p.completeThrough)) : null;
    p.statusAirtable = p.status;
    if (p.status === 'Impaired' && p.dataAge != null && p.dataAge < MIN_DATA_MONTHS) {
      p.status = 'Maturing';
      p.lagAdjusted = true;
    }
    p.threshold = p.fixed != null ? p.fixed : p.marketing;
    p.recoupPct = p.threshold > 0 ? p.gross / p.threshold : null;
    // Consistency against the Airtable rollups (the money source of truth).
    if (Math.abs(cg - p.gross) > 0.5) checks.push({ project: p.title, field: 'gross', lines: r2(cg), rollup: r2(p.gross) });
    if (Math.abs(cm - p.marketing) > 0.5) checks.push({ project: p.title, field: 'marketing', lines: r2(cm), rollup: r2(p.marketing) });
    if (Math.abs(ca - p.artistCosts) > 0.5) checks.push({ project: p.title, field: 'artistCosts', lines: r2(ca), rollup: r2(p.artistCosts) });
    if (recouped !== (p.statusAirtable === 'Recouped')) {
      checks.push({ project: p.title, field: 'status', lines: recouped ? 'recoupé (latch)' : 'non recoupé', rollup: p.statusAirtable });
    }
    p.expenses.sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }

  // Portfolio = projects with marketing (the recoupment test perimeter, actual spend).
  const port = projects.filter((p) => p.marketing > 0);
  const sum = (arr, k) => r2(arr.reduce((s, x) => s + x[k], 0));
  const deployed = sum(port, 'marketing');
  const grossPort = sum(port, 'gross');
  const recovered = r2(port.reduce((s, p) => s + Math.min(p.gross, p.marketing), 0));
  const atRisk = r2(port.filter((p) => p.status !== 'Recouped').reduce((s, p) => s + p.remaining, 0));
  const winners = port.filter((p) => p.status === 'Recouped');
  const winGross = sum(winners, 'gross'), winMkt = sum(winners, 'marketing');

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
      deployedCum: r2(cumM), recoveredCum: r2(recov), state: stateOf(m),
    };
  });

  // ---- répartition: the month in two speeds ----
  // Speed 1, known the same day: what was spent. Speed 2, known 2–3 months later:
  // what the streams of the month earned, split into the three pockets.
  const statementByMonth = {};
  const statements = raw.periods.map((rec) => {
    const f = rec.fields;
    const a = byPeriod.get(rec.id) || { revenue: 0, gross: 0, usage: new Set(), projects: new Set() };
    const usage = [...a.usage].sort();
    const name = f[F.per.name] || '';
    const st = {
      name, received: f[F.per.received] || null, newMoney: num(f[F.per.csvTotal]),
      linesRevenue: r2(a.revenue), usageFrom: usage[0] || null, usageTo: usage[usage.length - 1] || null, usageMonths: usage.length,
      projects: [...a.projects],
    };
    if (/^\d{4}-\d{2}$/.test(name)) statementByMonth[name] = (statementByMonth[name] || 0) + st.newMoney;
    return st;
  }).sort((a, b) => (b.received ? 1 : 0) - (a.received ? 1 : 0) || String(b.received || '').localeCompare(String(a.received || '')) || String(b.name).localeCompare(String(a.name)));

  const repartition = axis.map((m, i) => {
    const row = {
      m, state: stateOf(m), expected: expected(m),
      statementReceived: statementByMonth[m] != null ? r2(statementByMonth[m]) : null,
      spend: { total: 0, capex: 0, catalogue: 0, unassigned: r2(unassigned[m] || 0) },
      recouped: { gross: 0, revenue: 0, dues: 0, spend: 0, margin: 0, count: 0, noLabelCut: { revenue: 0, spend: 0, count: 0 } },
      recouping: { recovered: 0, invested: 0, variation: 0, remainingEnd: 0, count: 0 },
      nospend: { gross: 0, revenue: 0 },
      coverage: null,
      projects: [],
    };
    const R = row.recouped, U = row.recouping;
    let capex = 0, catalogueSpend = unassigned[m] || 0; // playlist campaigns without a project = catalogue
    for (const p of projects) {
      const w = p.raw[i];
      if (!w.gross && !w.spend && !w.revenue) { if (w.pocket !== 'nospend' && w.pocket !== 'recouped') U.remainingEnd += w.remainingEnd; continue; }
      const d = { id: p.id, title: p.title, pocket: w.pocket, gross: r2(w.gross), revenue: r2(w.revenue), spend: r2(w.spend) };
      if (w.pocket === 'nospend') {
        row.nospend.gross += w.gross; row.nospend.revenue += w.revenue;
        capex += w.spend; // artist-account costs on a title without marketing (advance): still an investment
      } else if (w.pocket === 'recouped') {
        catalogueSpend += w.spend;
        if (w.duesKnown) {
          R.gross += w.gross; R.revenue += w.revenue; R.dues += w.dues; R.spend += w.spend; R.count += 1;
          d.dues = r2(w.dues); d.margin = r2(w.revenue - w.dues - w.spend);
        } else {
          R.noLabelCut.revenue += w.revenue; R.noLabelCut.spend += w.spend; R.noLabelCut.count += 1;
          d.noLabelCut = true;
        }
      } else {
        // recouping or crossing: spend is capex; gross up to the threshold is recovery,
        // the excess (crossing month only) already belongs to the recouped pocket.
        capex += w.spend;
        U.recovered += w.gross * (1 - w.frac); U.invested += w.spend; U.count += 1;
        U.remainingEnd += w.remainingEnd;
        d.recovered = r2(w.gross * (1 - w.frac));
        if (w.frac > 0) {
          if (w.duesKnown) {
            R.gross += w.gross * w.frac; R.revenue += w.revenue * w.frac; R.dues += w.dues * w.frac; R.count += 1;
            d.margin = r2((w.revenue - w.dues) * w.frac);
          } else {
            R.noLabelCut.revenue += w.revenue * w.frac; R.noLabelCut.count += 1;
          }
          d.crossing = true;
        }
      }
      row.projects.push(d);
    }
    R.margin = R.revenue - R.dues - R.spend;
    U.variation = U.recovered - U.invested;
    row.spend.capex = r2(capex);
    row.spend.catalogue = r2(catalogueSpend);
    row.spend.total = r2(capex + catalogueSpend);
    for (const k of ['gross', 'revenue', 'dues', 'spend', 'margin']) R[k] = r2(R[k]);
    R.noLabelCut.revenue = r2(R.noLabelCut.revenue); R.noLabelCut.spend = r2(R.noLabelCut.spend);
    for (const k of ['recovered', 'invested', 'variation', 'remainingEnd']) U[k] = r2(U[k]);
    row.nospend.gross = r2(row.nospend.gross); row.nospend.revenue = r2(row.nospend.revenue);
    row.coverage = row.state === 'pending' ? null : R.margin / STRUCTURE_COSTS;
    row.projects.sort((a, b) => (b.gross + b.spend) - (a.gross + a.spend));
    return row;
  });

  for (const p of projects) delete p.raw;

  return {
    generatedAt: new Date().toISOString(),
    now,
    months: axis,
    coverage: { bySource: lastBySource, completeBySource, completeUntil, partialUntil },
    structureCosts: STRUCTURE_COSTS,
    kpis: {
      deployed, recovered, atRisk, grossPortfolio: grossPort,
      multiple: deployed > 0 ? grossPort / deployed : null,
      winners: { count: winners.length, gross: winGross, marketing: winMkt, multiple: winMkt > 0 ? winGross / winMkt : null },
      grossCatalogue: sum(projects, 'gross'),
      streamsCatalogue: projects.reduce((s, p) => s + p.streams, 0),
      portfolioCount: port.length,
      lagAdjusted: projects.filter((p) => p.lagAdjusted).length,
      byStatus: ['Recouped', 'Maturing', 'Impaired', 'No spend'].map((st) => {
        const g = projects.filter((p) => p.status === st);
        return { status: st, count: g.length, marketing: sum(g, 'marketing'), gross: sum(g, 'gross'), remaining: sum(g, 'remaining') };
      }),
    },
    catalogue,
    repartition,
    statements,
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
    fixed: p.fixed,
    recoupedIn: p.recoupedIn || null,
    streams: p.streams,
    ugc: p.ugc,
    dataUntil: p.dataUntil,
    completeThrough: p.completeThrough,
    artistShare: p.labelCut == null ? null : 1 - p.labelCut,
    splits: p.splits.map((s) => ({ payee: s.payee, share: s.share })),
    series: p.series.map((s) => ({
      m: s.m, gross: s.gross, streams: s.streams, marketing: s.marketing, cumGross: s.cumGross, cumMarketing: s.cumMarketing, state: s.state,
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
