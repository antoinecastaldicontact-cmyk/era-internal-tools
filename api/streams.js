// /api/streams?id=XXXX — flux temporels d'une activité pour la courbe FC.
// Whitelist stricte : time, heartrate, distance, velocity_smooth. Jamais latlng.
// Cache CDN 24h : une activité passée ne change pas, on protège le quota Strava.

const ALLOWED_STREAMS = ['time', 'heartrate', 'distance', 'velocity_smooth'];
const MAX_POINTS = 300;

function downsample(arr, n) {
  if (!arr || arr.length <= n) return arr;
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}

export default async function handler(req, res) {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;
  const id = String(req.query.id || '');

  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'bad_id' });
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'missing_env' });
  }

  try {
    const tokenResp = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        refresh_token: STRAVA_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    if (!tokenResp.ok) return res.status(502).json({ error: 'token_refresh_failed' });
    const { access_token: accessToken } = await tokenResp.json();

    const url = new URL(`https://www.strava.com/api/v3/activities/${id}/streams`);
    url.searchParams.set('keys', ALLOWED_STREAMS.join(','));
    url.searchParams.set('key_by_type', 'true');

    const sResp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!sResp.ok) return res.status(sResp.status === 404 ? 404 : 502).json({ error: 'streams_fetch_failed', status: sResp.status });
    const raw = await sResp.json();

    const out = {};
    for (const key of ALLOWED_STREAMS) {
      if (raw[key] && Array.isArray(raw[key].data)) out[key] = downsample(raw[key].data, MAX_POINTS);
    }

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: 'internal', message: String(err && err.message) });
  }
}
