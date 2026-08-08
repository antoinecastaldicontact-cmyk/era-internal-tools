// /api/meta-sign — génère un lien client signé pour /client-report/.
// Protégé par REPORT_ADMIN_SECRET : seul Antoine (qui connaît le secret) peut
// générer des liens. Le lien produit est ensuite librement partageable.

import crypto from 'crypto';

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export default function handler(req, res) {
  const { REPORT_ADMIN_SECRET } = process.env;
  if (!REPORT_ADMIN_SECRET) {
    return res.status(500).json({
      error: 'missing_env',
      message: 'Variable manquante sur Vercel : REPORT_ADMIN_SECRET.',
    });
  }

  const { key = '', c = '', t = '' } = req.query;
  if (!key || !safeEqual(key, REPORT_ADMIN_SECRET)) {
    return res.status(403).json({ error: 'forbidden', message: 'Clé admin invalide.' });
  }

  const ids = String(c).split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length || ids.length > 4 || ids.some(id => !/^\d{5,25}$/.test(id))) {
    return res.status(400).json({ error: 'bad_request', message: 'Paramètre c invalide.' });
  }

  const cNorm = ids.join(',');
  const title = String(t).slice(0, 120);
  const sig = hmac(REPORT_ADMIN_SECRET, `${cNorm}|${title}`);

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${host}/client-report/?c=${encodeURIComponent(cNorm)}&t=${encodeURIComponent(title)}&sig=${sig}`;

  return res.status(200).json({ url });
}
