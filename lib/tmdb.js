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

// `ttl` is the browser/CDN cache lifetime in seconds for successful responses.
export async function tmdbFetch(path, env, { ttl = 0 } = {}) {
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

  const data = await res.json();
  const cache = ttl > 0
    ? { 'cache-control': `public, max-age=${ttl}, stale-while-revalidate=${ttl}` }
    : {};
  return jsonResponse(data, 200, cache);
}
