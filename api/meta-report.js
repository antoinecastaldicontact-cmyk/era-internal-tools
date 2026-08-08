// /api/meta-report — proxy Meta Graph API en LECTURE SEULE pour les rapports clients.
// Le token Meta vit dans les env vars Vercel (META_ACCESS_TOKEN), jamais côté client.
// Chaque lien client est signé (HMAC) : impossible de forger une URL vers une autre
// campagne sans connaître REPORT_ADMIN_SECRET.
//
// Env vars requises sur Vercel :
//   META_ACCESS_TOKEN     — token système Meta (lecture ads_read)
//   REPORT_ADMIN_SECRET   — secret aléatoire long (signe les liens + protège /api/meta-sign)
// Optionnelle :
//   META_API_VERSION      — défaut v21.0

import crypto from 'crypto';

const MAX_CAMPAIGNS = 4;

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function graph(version, token, path) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`https://graph.facebook.com/${version}/${path}${sep}access_token=${token}`);
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Meta API error');
  return d;
}

export default async function handler(req, res) {
  const { META_ACCESS_TOKEN, REPORT_ADMIN_SECRET } = process.env;
  const version = process.env.META_API_VERSION || 'v21.0';

  if (!META_ACCESS_TOKEN || !REPORT_ADMIN_SECRET) {
    return res.status(500).json({
      error: 'missing_env',
      message: 'Variables manquantes sur Vercel : META_ACCESS_TOKEN et/ou REPORT_ADMIN_SECRET.',
    });
  }

  const { c = '', t = '', sig = '' } = req.query;

  // c = IDs de campagnes séparés par des virgules (chiffres uniquement)
  const ids = String(c).split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length || ids.length > MAX_CAMPAIGNS || ids.some(id => !/^\d{5,25}$/.test(id))) {
    return res.status(400).json({ error: 'bad_request', message: 'Paramètre c invalide.' });
  }

  // Vérification de signature : HMAC(c|t). Le titre est signé aussi.
  const expected = hmac(REPORT_ADMIN_SECRET, `${ids.join(',')}|${String(t)}`);
  if (!sig || !safeEqual(sig, expected)) {
    return res.status(403).json({ error: 'invalid_signature', message: 'Lien invalide ou expiré.' });
  }

  try {
    const end = new Date().toISOString().split('T')[0];
    const insightFields = 'reach,impressions,spend,cpm,ctr,frequency,actions';

    const campaigns = await Promise.all(ids.map(async (id) => {
      const meta = await graph(version, META_ACCESS_TOKEN, `${id}?fields=name,status,start_time`);
      const since = meta.start_time ? meta.start_time.split('T')[0] : '2020-01-01';
      const tr = `since=${since}&until=${end}`;
      const [totals, daily, countries, ads, adLinks] = await Promise.all([
        graph(version, META_ACCESS_TOKEN, `${id}/insights?fields=${insightFields}&${tr}`),
        graph(version, META_ACCESS_TOKEN, `${id}/insights?fields=${insightFields}&time_increment=1&${tr}&limit=400`),
        graph(version, META_ACCESS_TOKEN, `${id}/insights?fields=${insightFields}&breakdowns=country&${tr}&limit=100`),
        graph(version, META_ACCESS_TOKEN, `${id}/insights?fields=ad_id,ad_name,spend,impressions,reach,actions&level=ad&${tr}&limit=60`),
        graph(version, META_ACCESS_TOKEN, `${id}/ads?fields=id,preview_shareable_link&limit=200`).catch(() => ({ data: [] })),
      ]);
      const linkById = {};
      for (const a of (adLinks.data || [])) if (a.preview_shareable_link) linkById[a.id] = a.preview_shareable_link;
      // Whitelist stricte des champs renvoyés au navigateur du client
      const pick = (row) => ({
        date_start: row.date_start, date_stop: row.date_stop, country: row.country,
        reach: row.reach, impressions: row.impressions, spend: row.spend,
        cpm: row.cpm, ctr: row.ctr, frequency: row.frequency, actions: row.actions,
      });
      return {
        id,
        name: meta.name,
        status: meta.status,
        start_time: meta.start_time || null,
        totals: totals.data?.[0] ? pick(totals.data[0]) : null,
        daily: (daily.data || []).map(pick),
        countries: (countries.data || []).map(pick),
        ads: (ads.data || []).map(a => ({
          name: a.ad_name, spend: a.spend, impressions: a.impressions,
          reach: a.reach, actions: a.actions, preview: linkById[a.ad_id] || null,
        })),
      };
    }));

    // Cache CDN 15 min : le client peut recharger sans marteler Meta
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json({ generated_at: new Date().toISOString(), campaigns });
  } catch (e) {
    return res.status(502).json({ error: 'meta_error', message: e.message });
  }
}
