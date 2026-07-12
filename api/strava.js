// /api/strava — proxy Strava en lecture seule pour le dashboard marathon.
// Rafraîchit le token via le refresh_token (env vars Vercel), récupère les
// activités depuis le début de la prépa, et ne renvoie QUE des champs
// whitelistés : aucune coordonnée GPS, aucune polyline, aucune localisation.

const PLAN_FETCH_AFTER = Math.floor(Date.UTC(2026, 5, 22) / 1000); // 22 juin 2026

const FIELD_WHITELIST = [
  'id',
  'name',
  'sport_type',
  'workout_type',
  'start_date_local',
  'distance',
  'moving_time',
  'elapsed_time',
  'total_elevation_gain',
  'average_speed',
  'max_speed',
  'average_heartrate',
  'max_heartrate',
  'average_cadence',
  'suffer_score',
];

export default async function handler(req, res) {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;

  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REFRESH_TOKEN) {
    return res.status(500).json({
      error: 'missing_env',
      message:
        'Variables manquantes sur Vercel : STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN.',
    });
  }

  try {
    // 1. Refresh token → access token (validité 6h, on ne le stocke jamais)
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

    if (!tokenResp.ok) {
      const detail = await tokenResp.text();
      return res.status(502).json({ error: 'token_refresh_failed', status: tokenResp.status, detail });
    }

    const { access_token: accessToken } = await tokenResp.json();

    // 2. Activités depuis le début de la prépa (pagination, 3 pages max = 600 activités)
    const activities = [];
    for (let page = 1; page <= 3; page++) {
      const url = new URL('https://www.strava.com/api/v3/athlete/activities');
      url.searchParams.set('after', String(PLAN_FETCH_AFTER));
      url.searchParams.set('per_page', '200');
      url.searchParams.set('page', String(page));

      const actResp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!actResp.ok) {
        const detail = await actResp.text();
        return res.status(502).json({ error: 'activities_fetch_failed', status: actResp.status, detail });
      }

      const batch = await actResp.json();
      activities.push(...batch);
      if (batch.length < 200) break;
    }

    // 3. Whitelist stricte des champs — rien d'autre ne sort
    const sanitized = activities.map((a) => {
      const out = {};
      for (const key of FIELD_WHITELIST) {
        if (a[key] !== undefined && a[key] !== null) out[key] = a[key];
      }
      return out;
    });

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).json({
      updated_at: new Date().toISOString(),
      count: sanitized.length,
      activities: sanitized,
    });
  } catch (err) {
    return res.status(500).json({ error: 'internal', message: String(err && err.message) });
  }
}
