// /api/royalties — data of the royalties cockpit (admin only).
//   GET /api/royalties?health=1        → no data: env present? Airtable reachable?
//   GET /api/royalties                 → full model (header x-admin-key required)
//   GET /api/royalties?refresh=1       → same, bypassing the 10-min cache
//   GET /api/royalties?sign=recXXXX    → signed artist link for one project
// Never cached at the CDN: the response depends on a header, not on the URL.

import { getModel, ping, safeEqual, signArtist } from './_royalties.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const { AIRTABLE_TOKEN, ROYALTIES_ADMIN_KEY } = process.env;

  if (req.query.health) {
    let airtable = 'missing_token';
    if (AIRTABLE_TOKEN) {
      try {
        const s = await ping(AIRTABLE_TOKEN);
        airtable = s === 200 ? 'ok' : s === 403 || s === 404 ? 'no_access_to_base' : s === 401 ? 'invalid_token' : `http_${s}`;
      } catch (e) {
        airtable = 'unreachable';
      }
    }
    // Counts only — no money figures leave this endpoint without the admin key.
    let model = null;
    if (airtable === 'ok') {
      try {
        const m = await getModel(AIRTABLE_TOKEN);
        model = { projects: m.projects.length, months: m.months.length, checks: m.checks.length, completeUntil: m.coverage.completeUntil };
      } catch (e) {
        model = { error: 'build_failed' };
      }
    }
    return res.status(200).json({ airtable, adminKey: !!ROYALTIES_ADMIN_KEY, model });
  }

  if (!ROYALTIES_ADMIN_KEY) return res.status(503).json({ error: 'missing_admin_key' });
  const key = req.headers['x-admin-key'] || '';
  if (!key || !safeEqual(key, ROYALTIES_ADMIN_KEY)) return res.status(401).json({ error: 'unauthorized' });
  if (!AIRTABLE_TOKEN) return res.status(503).json({ error: 'missing_airtable_token' });

  if (req.query.sign) {
    const id = String(req.query.sign);
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ error: 'bad_id' });
    return res.status(200).json({ path: `/royalties/artiste/?p=${id}&s=${signArtist(ROYALTIES_ADMIN_KEY, id)}` });
  }

  try {
    const model = await getModel(AIRTABLE_TOKEN, { refresh: !!req.query.refresh });
    return res.status(200).json(model);
  } catch (err) {
    const status = err.status === 403 || err.status === 404 ? 'no_access_to_base' : 'airtable_error';
    return res.status(502).json({ error: status, detail: String(err.message) });
  }
}
