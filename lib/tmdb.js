// Shared helpers for the /api Pages Functions. Lives outside functions/ so
// Pages doesn't treat it as a route or as middleware.

const TMDB_BASE = 'https://api.themoviedb.org/3';

export function validateInt(val, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function checkApiKey(env) {
  if (!env.TMDB_API_KEY) {
    console.error('TMDB_API_KEY is not set');
    return jsonResponse({ error: 'Server is not configured' }, 500);
  }
  return null;
}

// TMDB accepts either a v4 "API Read Access Token" (a JWT, sent as a Bearer
// header) or a legacy v3 API key (sent as ?api_key=). Prefer the header so the
// secret stays out of URLs and logs; fall back for existing v3 deployments.
function authorize(path, key) {
  if (key.startsWith('eyJ')) {
    return { url: `${TMDB_BASE}${path}`, headers: { authorization: `Bearer ${key}` } };
  }
  const sep = path.includes('?') ? '&' : '?';
  return { url: `${TMDB_BASE}${path}${sep}api_key=${encodeURIComponent(key)}`, headers: {} };
}

// Field allowlists: the client only needs a handful of fields, and trimming
// cuts payloads by most of their size before they are cached.
const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
};

const LIST_ITEM = ['id', 'media_type', 'title', 'name', 'release_date', 'first_air_date', 'poster_path'];

export const shapes = {
  list: (d) => ({
    page: d.page,
    total_pages: d.total_pages,
    results: (d.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r) => pick(r, LIST_ITEM)),
  }),
  tv: (d) => ({
    ...pick(d, ['id', 'name', 'overview', 'poster_path', 'first_air_date']),
    seasons: (d.seasons || []).map((s) => pick(s, ['season_number', 'name', 'episode_count'])),
  }),
  season: (d) => ({
    season_number: d.season_number,
    episodes: (d.episodes || []).map((e) => pick(e, ['episode_number', 'name', 'air_date'])),
  }),
  movie: (d) => pick(d, ['id', 'title', 'overview', 'poster_path', 'release_date', 'runtime']),
};

// Cache key for a TMDB path. Never includes the API key.
function cacheKey(path) {
  return new Request(`https://tmdb-cache.flix.internal${path}`);
}

function cacheHeaders(ttl) {
  return ttl > 0
    ? { 'cache-control': `public, max-age=${ttl}, stale-while-revalidate=${ttl}` }
    : {};
}

// `ttl` is the browser and edge cache lifetime in seconds for successful
// responses. Successful, shaped responses are stored in the colo's edge cache
// (caches.default), so repeat requests skip TMDB entirely.
export async function tmdbFetch(path, env, { ttl = 0, shape, ctx } = {}) {
  const cache = ttl > 0 && typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    try {
      const hit = await cache.match(cacheKey(path));
      if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set('x-flix-cache', 'HIT');
        return res;
      }
    } catch (err) {
      console.error('Cache read failed', err);
    }
  }

  const { url, headers } = authorize(path, env.TMDB_API_KEY);

  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('TMDB request failed', path, err);
    return jsonResponse({ error: 'Upstream request failed' }, 502);
  }

  if (!res.ok) {
    // Don't relay TMDB's raw error body; it can describe our auth setup.
    console.error('TMDB error', res.status, path);
    if (res.status === 404) return jsonResponse({ error: 'Not found' }, 404);
    if (res.status === 429) return jsonResponse({ error: 'Too many requests, try again shortly' }, 503);
    return jsonResponse({ error: 'Upstream error' }, 502);
  }

  const raw = await res.json();
  const data = shape ? shape(raw) : raw;
  const response = jsonResponse(data, 200, cacheHeaders(ttl));

  if (cache) {
    const put = cache.put(cacheKey(path), response.clone()).catch((err) => console.error('Cache write failed', err));
    if (ctx?.waitUntil) ctx.waitUntil(put);
  }
  response.headers.set('x-flix-cache', 'MISS');
  return response;
}
