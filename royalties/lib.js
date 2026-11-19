// Royalties cockpit — shared helpers (formatting, API, auth, statuses).
// Plain script: exposes window.R. No build step, no dependency.
(function () {
  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const eur = (v, d = 0) => (v == null || !isFinite(v) ? '—' : (d ? nf2 : nf0).format(v) + ' €');
  const eurC = (v) => {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e6) return nf1.format(v / 1e6) + ' M€';
    if (a >= 1e3) return nf1.format(v / 1e3) + ' k€';
    return nf0.format(v) + ' €';
  };
  const int = (v) => (v == null || !isFinite(v) ? '—' : nf0.format(v));
  const intC = (v) => {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e6) return nf1.format(v / 1e6) + ' M';
    if (a >= 1e3) return nf1.format(v / 1e3) + ' k';
    return nf0.format(v);
  };
  const pct = (v, d = 0) => (v == null || !isFinite(v) ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(v * 100) + ' %');
  const mult = (v) => (v == null || !isFinite(v) ? '—' : nf2.format(v) + '×');

  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const mShort = (m) => (m ? `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}` : '—');
  const mLong = (m) => (m ? `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : '—');
  const date = (iso) => {
    if (!iso) return '—';
    const [y, mo, d] = iso.slice(0, 10).split('-');
    return `${+d} ${MONTHS[+mo - 1]} ${y}`;
  };
  const dateTime = (iso) => {
    try {
      return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = (k) => new URLSearchParams(location.search).get(k);

  // ---- storage (can throw in some contexts: always wrapped) ----
  const KEY = 'era_royalties_key';
  const CACHE = 'era_royalties_model';
  const store = {
    get(k, s = localStorage) { try { return s.getItem(k); } catch (e) { return null; } },
    set(k, v, s = localStorage) { try { s.setItem(k, v); } catch (e) { /* quota or disabled */ } },
    del(k, s = localStorage) { try { s.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const ERRORS = {
    no_key: 'Clé admin requise.',
    unauthorized: 'Clé admin refusée.',
    missing_admin_key: 'ROYALTIES_ADMIN_KEY n’est pas définie sur Vercel (projet era-internal-tools).',
    missing_airtable_token: 'AIRTABLE_TOKEN absent de cet environnement Vercel.',
    no_access_to_base: 'Le token Airtable de Vercel n’a pas accès à la base ERA Reporting & Royalties (appBvSWFIA6P36nXu).',
    airtable_error: 'Airtable a renvoyé une erreur. Réessaie dans une minute.',
    not_configured: 'Ce relevé n’est pas encore disponible.',
    bad_link: 'Lien invalide. Demande un nouveau lien à ERA.',
    not_found: 'Titre introuvable.',
    network: 'Réseau indisponible.',
  };
  const errorText = (code) => ERRORS[code] || `Erreur (${code}).`;

  async function getJSON(path, headers = {}) {
    let r;
    try { r = await fetch(path, { headers }); } catch (e) { throw { code: 'network' }; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw { code: d.error || `http_${r.status}`, status: r.status };
    return d;
  }

  async function admin(path) {
    const key = store.get(KEY);
    if (!key) throw { code: 'no_key' };
    try {
      return await getJSON(path, { 'x-admin-key': key });
    } catch (e) {
      if (e.status === 401) { store.del(KEY); store.del(CACHE, sessionStorage); }
      throw e;
    }
  }

  // The model changes once a month: keep it 5 min in this tab to make
  // macro ↔ projet navigation instant.
  async function model({ refresh = false } = {}) {
    if (!refresh) {
      const raw = store.get(CACHE, sessionStorage);
      if (raw) {
        try {
          const c = JSON.parse(raw);
          if (Date.now() - c.at < 5 * 60 * 1000) return c.data;
        } catch (e) { /* ignore */ }
      }
    }
    const data = await admin(`/api/royalties${refresh ? '?refresh=1' : ''}`);
    store.set(CACHE, JSON.stringify({ at: Date.now(), data }), sessionStorage);
    return data;
  }

  function lock(root, message, onKey) {
    root.innerHTML = `
      <div class="lock">
        <div class="lock-title">Accès admin</div>
        <p class="lock-msg">${esc(message || 'Colle la clé ROYALTIES_ADMIN_KEY. Elle reste dans ce navigateur uniquement.')}</p>
        <form class="lock-form">
          <input type="password" name="k" autocomplete="off" placeholder="Clé admin" required>
          <button type="submit">Ouvrir</button>
        </form>
      </div>`;
    root.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = ev.target.k.value.trim();
      if (!v) return;
      store.set(KEY, v);
      onKey();
    });
    root.querySelector('input').focus();
  }

  function resetKey() { store.del(KEY); store.del(CACHE, sessionStorage); }

  // ---- statuses: colour always paired with an icon and a label ----
  const STATUS = {
    Recouped: { fr: 'Recoupé', icon: '✓', cls: 'good' },
    Maturing: { fr: 'En maturation', icon: '◷', cls: 'warn' },
    Impaired: { fr: 'Impaired', icon: '✕', cls: 'crit', hint: '6 mois de revenus complets sans recoupement' },
    'No spend': { fr: 'Sans dépense', icon: '○', cls: 'muted' },
  };
  const statusPill = (st) => {
    const s = STATUS[st] || STATUS['No spend'];
    return `<span class="pill ${s.cls}"><span class="pill-ic" aria-hidden="true">${s.icon}</span>${esc(s.fr)}</span>`;
  };

  const SPLIT_ADMIN = {
    'Not recouped': 'Non recoupé',
    'Due: activate on Wiseband': 'À activer sur Wiseband',
    'Active on Wiseband': 'Actif sur Wiseband',
    'Due: ERA pays artist (ADA)': 'ERA doit payer l’artiste (ADA)',
    'Paid by ERA (ADA)': 'Payé par ERA (ADA)',
    'Not applicable': 'Non applicable',
    'Artist advance not recouped': 'Avance artiste non recoupée',
  };

  const BUCKET = {
    'Marketing (from gross)': 'Marketing',
    'Artist account (from artist share)': 'Compte artiste',
  };

  // ---- reporting state of a usage month (the second speed) ----
  const STATE = {
    complete: { fr: 'complet', icon: '✓', cls: 'good' },
    partial: { fr: 'partiel', icon: '◐', cls: 'warn' },
    pending: { fr: 'attendu', icon: '◷', cls: 'muted' },
  };
  const dayMonth = (iso) => {
    if (!iso) return '—';
    const [, mo, d] = iso.split('-');
    return `${+d} ${MONTHS[+mo - 1]}`;
  };
  const stateText = (state, exp) => {
    if (state === 'complete') return 'Tous les stores reportés.';
    if (state === 'partial') return `Sans Spotify, Deezer ni Qobuz. Complet vers le ${date(exp.complete)}.`;
    return `Partiel vers le ${date(exp.partial)}, complet vers le ${date(exp.complete)}.`;
  };
  const stateChip = (state, exp) => {
    const s = STATE[state] || STATE.pending;
    const label = state === 'pending' && exp ? `attendu ${dayMonth(exp.partial)}` : s.fr;
    return `<span class="pill ${s.cls}" title="${esc(stateText(state, exp))}"><span class="pill-ic" aria-hidden="true">${s.icon}</span>${esc(label)}</span>`;
  };

  const nav = (active) => `<nav class="tabs" aria-label="Royalties">
      <a href="/royalties/" ${active === 'macro' ? 'aria-current="page"' : ''}>Vue macro</a>
      <a href="/royalties/repartition/" ${active === 'repartition' ? 'aria-current="page"' : ''}>Répartition mensuelle</a>
    </nav>`;

  // ---- artist statement emails ----
  // A mailto opens Antoine's mail app with the message ready (no subject: his rule).
  // Nothing is sent until he clicks Send himself.
  const pctEn = (v) => `${Math.floor(Math.max(0, v) * 100)}%`;
  const statusEn = (p) => (p.status === 'Recouped' ? 'Recouped' : p.recoupPct != null && p.threshold > 0 ? `${pctEn(Math.min(p.recoupPct, 0.99))} recouped` : 'No marketing to recoup');
  function statementBody(name, projects) {
    const items = projects.map((p) => `${p.title} — ${statusEn(p)}\n${location.origin}${p.artistPath}`).join('\n\n');
    return `Hi ${name},\n\nYour royalty statement is ready.\n\n${items}\n\nThis is your official statement, certified by ERA Music from our distributor reports. You can download it as a PDF from the page.\n\nAntoine\nERA Music`;
  }
  const mailto = (emails, body) => `mailto:${emails.join(',')}?body=${encodeURIComponent(body)}`;
  // Payees of a list of projects, grouped by email.
  function recipients(projects) {
    const by = new Map();
    for (const p of projects) {
      for (const sp of p.splits || []) {
        if (!sp.email) continue;
        const k = sp.email.toLowerCase();
        const r = by.get(k) || { email: sp.email, name: sp.payee, projects: [] };
        if (!r.projects.includes(p)) r.projects.push(p);
        by.set(k, r);
      }
    }
    return [...by.values()];
  }
  // Projects that get a statement: in the given statement, with an artist side.
  // Titles without a split stay in the list, flagged as missing a recipient.
  const statementEligible = (p) => !/residual/i.test(p.title) && !(p.dealType || '').startsWith('Cover buyout');

  window.R = {
    statusEn, statementBody, mailto, recipients, statementEligible,
    STATE, stateText, stateChip, dayMonth, nav,
    eur, eurC, int, intC, pct, mult, mShort, mLong, date, dateTime, esc, qs,
    admin, getJSON, model, lock, resetKey, errorText, STATUS, statusPill, SPLIT_ADMIN, BUCKET, store,
  };
})();
