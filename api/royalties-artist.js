// /api/royalties-artist?p=recXXXX&s=SIG — one project, artist-facing fields only.
// The link is signed with ROYALTIES_ADMIN_KEY: an artist cannot open another
// project by editing the URL. No internal notes, no other titles, no label net.

import { getModel, artistView, safeEqual, signArtist } from './_royalties.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const { AIRTABLE_TOKEN, ROYALTIES_ADMIN_KEY } = process.env;
  const id = String(req.query.p || '');
  const sig = String(req.query.s || '');

  if (!AIRTABLE_TOKEN || !ROYALTIES_ADMIN_KEY) return res.status(503).json({ error: 'not_configured' });
  if (!/^rec[A-Za-z0-9]{14}$/.test(id) || !sig) return res.status(400).json({ error: 'bad_link' });
  if (!safeEqual(sig, signArtist(ROYALTIES_ADMIN_KEY, id))) return res.status(403).json({ error: 'bad_link' });

  try {
    const view = artistView(await getModel(AIRTABLE_TOKEN), id);
    if (!view) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json(view);
  } catch (err) {
    return res.status(502).json({ error: 'airtable_error' });
  }
}
