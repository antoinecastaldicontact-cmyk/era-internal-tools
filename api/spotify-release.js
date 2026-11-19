// /api/spotify-release?url=<lien Spotify> — infos release lues sur les pages publiques Spotify.
// Pas d'API Web Spotify (Premium exigé depuis février 2026) : on lit la page embed
// (__NEXT_DATA__), puis les balises og: de la page publique, puis l'oEmbed, dans cet ordre.
// /api/spotify-release?artwork=<url i.scdn.co>&name=<fichier> — renvoie la pochette en
// téléchargement avec le bon nom de fichier (hôtes limités aux CDN Spotify : pas de proxy ouvert).

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const ID_RE = /^[A-Za-z0-9]{22}$/;
const TYPES = ['track', 'album'];

function parseSpotifyRef(input) {
  const s = String(input || '').trim();
  const uri = s.match(/^spotify:(track|album):([A-Za-z0-9]{22})$/);
  if (uri) return { type: uri[1], id: uri[2] };
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.hostname !== 'open.spotify.com' && u.hostname !== 'play.spotify.com') return null;
  const m = u.pathname.match(/^\/(?:intl-[a-z]{2}(?:-[A-Za-z]+)?\/)?(?:embed\/)?(track|album)\/([A-Za-z0-9]{22})\/?$/);
  return m ? { type: m[1], id: m[2] } : null;
}

// Liens courts (spotify.link → spotify.app.link → open.spotify.com)
async function resolveShortLink(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return null; }
  if (!['spotify.link', 'spotify.app.link'].includes(u.hostname)) return null;
  const r = await fetch(u.href, { redirect: 'follow', headers: { 'User-Agent': UA } });
  const direct = parseSpotifyRef(r.url);
  if (direct) return direct;
  const body = await r.text();
  const m = body.match(/https:\/\/open\.spotify\.com\/(track|album)\/([A-Za-z0-9]{22})/);
  return m ? { type: m[1], id: m[2] } : null;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function findEntity(node, uri, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return null;
  if (node.uri === uri && (node.name || node.title)) return node;
  for (const v of Object.values(node)) {
    const hit = findEntity(v, uri, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function largestImage(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const sized = list
    .map((x) => ({ url: x && x.url, w: Number((x && (x.maxWidth || x.width || x.maxHeight || x.height)) || 0) }))
    .filter((x) => x.url);
  sized.sort((a, b) => b.w - a.w);
  return sized.length ? sized[0].url : '';
}

function toIsoDate(v) {
  if (!v) return '';
  const s = typeof v === 'string' ? v : (v.isoString || v.date || v.iso || '');
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  return { status: r.status, text: r.ok ? await r.text() : '' };
}

// Source 1 : page embed
async function fromEmbed(type, id) {
  const { status, text } = await fetchText(`https://open.spotify.com/embed/${type}/${id}`);
  if (status === 404) return { notFound: true };
  const m = text.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const uri = `spotify:${type}:${id}`;
  const direct = data && data.props && data.props.pageProps && data.props.pageProps.state
    && data.props.pageProps.state.data && data.props.pageProps.state.data.entity;
  const e = (direct && (direct.name || direct.title)) ? direct : findEntity(data, uri);
  if (!e) return null;
  const artists = Array.isArray(e.artists) && e.artists.length
    ? e.artists.map((a) => a && a.name).filter(Boolean)
    : (e.subtitle ? String(e.subtitle).split(/\s*,\s*/).filter(Boolean) : []);
  const artwork = largestImage(e.visualIdentity && e.visualIdentity.image)
    || largestImage(e.coverArt && e.coverArt.sources)
    || largestImage(e.images);
  return {
    title: e.name || e.title || '',
    artists,
    releaseDate: toIsoDate(e.releaseDate || e.release_date),
    artworkUrl: artwork,
    trackCount: Array.isArray(e.trackList) ? e.trackList.length : null,
    firstTrackId: firstTrackId(e.trackList),
    source: 'embed',
  };
}

function firstTrackId(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const m = JSON.stringify(list[0]).match(/spotify:track:([A-Za-z0-9]{22})/);
  return m ? m[1] : '';
}

// Source 2 : balises og: de la page publique
async function fromOpenGraph(type, id) {
  const { status, text } = await fetchText(`https://open.spotify.com/${type}/${id}`);
  if (status === 404) return { notFound: true };
  if (!text) return null;
  const tags = {};
  for (const tag of text.match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name)="([^"]+)"/i) || [])[1];
    const content = (tag.match(/\bcontent="([^"]*)"/i) || [])[1];
    if (key && content !== undefined && !(key in tags)) tags[key.toLowerCase()] = decodeEntities(content);
  }
  const meta = (key) => tags[key] || '';
  const title = meta('og:title');
  if (!title) return null;
  // og:description : « Artiste · Song · 2026 » ou « Artiste · Single · 2026 »
  const parts = meta('og:description').split(/\s+·\s+/);
  const kinds = ['song', 'single', 'ep', 'album', 'compilation'];
  let artists = [];
  let kind = '';
  const k = parts.findIndex((p) => kinds.includes(p.toLowerCase()));
  if (k > 0) { artists = parts[k - 1].split(/\s*,\s*/).filter(Boolean); kind = parts[k].toLowerCase(); }
  const musician = meta('music:musician_description');
  if (!artists.length && musician) artists = musician.split(/\s*,\s*/).filter(Boolean);
  return {
    title,
    artists,
    releaseDate: toIsoDate(meta('music:release_date')),
    artworkUrl: meta('og:image'),
    kind,
    trackCount: null,
    source: 'opengraph',
  };
}

// Source 3 : oEmbed (titre + pochette seulement)
async function fromOEmbed(type, id) {
  const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${type}/${id}`)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j || !j.title) return null;
  return { title: decodeEntities(j.title), artists: [], releaseDate: '', artworkUrl: j.thumbnail_url || '', trackCount: null, source: 'oembed' };
}

// « Titre (feat. X) » → titre propre + feats nommés dans le titre
const FEAT_RE = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]/i;
function splitArtists(rawTitle, artists) {
  let title = String(rawTitle || '').trim();
  let featsFromTitle = [];
  const m = title.match(FEAT_RE);
  if (m) {
    featsFromTitle = m[1].split(/\s*(?:,|&|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    title = title.replace(FEAT_RE, '').trim();
  }
  const list = (artists || []).filter(Boolean);
  if (featsFromTitle.length) {
    const lower = featsFromTitle.map((s) => s.toLowerCase());
    const main = list.filter((a) => !lower.includes(a.toLowerCase()));
    return { title, artist: (main.length ? main : list.slice(0, 1)).join(' & '), feat: featsFromTitle.join(' & ') };
  }
  return { title, artist: list[0] || '', feat: list.slice(1).join(' & ') };
}

function releaseTypeFrom(type, info) {
  if (type !== 'album') return null;
  const kind = info.kind || '';
  if (kind === 'compilation') return 'Compilation';
  if (kind === 'ep') return 'EP';
  const n = info.trackCount;
  if (n) return n <= 3 ? 'Single' : n <= 6 ? 'EP' : 'Album';
  if (kind === 'single') return 'Single';
  if (kind === 'album') return 'Album';
  return null;
}

async function serveArtwork(req, res) {
  let u;
  try { u = new URL(String(req.query.artwork)); } catch { return res.status(400).json({ error: 'bad_artwork_url' }); }
  const okHost = u.hostname === 'i.scdn.co' || u.hostname.endsWith('.spotifycdn.com');
  if (u.protocol !== 'https:' || !okHost) return res.status(400).json({ error: 'artwork_host_not_allowed' });
  const name = String(req.query.name || 'artwork.jpg').toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 120) || 'artwork.jpg';
  const r = await fetch(u.href, { headers: { 'User-Agent': UA } });
  if (!r.ok) return res.status(502).json({ error: 'artwork_fetch_failed', status: r.status });
  const buf = Buffer.from(await r.arrayBuffer());
  res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 's-maxage=86400');
  return res.status(200).send(buf);
}

export default async function handler(req, res) {
  try {
    if (req.query.artwork) return await serveArtwork(req, res);

    const input = String(req.query.url || '');
    let ref = parseSpotifyRef(input);
    if (!ref) ref = await resolveShortLink(input).catch(() => null);
    if (!ref || !TYPES.includes(ref.type) || !ID_RE.test(ref.id)) {
      return res.status(400).json({ ok: false, error: 'bad_url' });
    }

    let info = null;
    let notFound = false;
    for (const source of [fromEmbed, fromOpenGraph, fromOEmbed]) {
      const r = await source(ref.type, ref.id).catch(() => null);
      if (r && r.notFound) { notFound = true; continue; }
      if (r && r.title) {
        // Une source partielle (sans artistes ou sans date) est complétée par la suivante.
        if (!info) info = r;
        else {
          if (!info.artists.length && r.artists.length) info.artists = r.artists;
          if (!info.releaseDate && r.releaseDate) info.releaseDate = r.releaseDate;
          if (!info.artworkUrl && r.artworkUrl) info.artworkUrl = r.artworkUrl;
          if (!info.kind && r.kind) info.kind = r.kind;
        }
        if (info.artists.length && info.releaseDate && info.artworkUrl) break;
      }
    }

    if (!info) return res.status(notFound ? 404 : 502).json({ ok: false, error: notFound ? 'not_found' : 'parse_failed' });

    // L'embed album ne porte pas la date : on la prend sur le premier titre.
    if (!info.releaseDate && ref.type === 'album' && info.firstTrackId) {
      const t = await fromEmbed('track', info.firstTrackId).catch(() => null);
      if (t && t.releaseDate) info.releaseDate = t.releaseDate;
    }

    const names = splitArtists(info.title, info.artists);
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      ok: true,
      type: ref.type,
      id: ref.id,
      spotifyUrl: `https://open.spotify.com/${ref.type}/${ref.id}`,
      title: names.title,
      artist: names.artist,
      feat: names.feat,
      artists: info.artists,
      releaseDate: info.releaseDate,
      releaseType: releaseTypeFrom(ref.type, info),
      trackCount: info.trackCount,
      artworkUrl: info.artworkUrl,
      source: info.source,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'internal', message: String(err && err.message) });
  }
}
