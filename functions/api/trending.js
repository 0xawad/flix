import { checkApiKey, jsonResponse, tmdbFetch, shapes } from '../../lib/tmdb.js';

const TYPES = new Set(['all', 'movie', 'tv']);

// GET /api/trending?type=all|movie|tv
export async function onRequest(context) {
  const { request, env } = context;

  const keyErr = checkApiKey(env);
  if (keyErr) return keyErr;

  const type = new URL(request.url).searchParams.get('type') || 'all';
  if (!TYPES.has(type)) {
    return jsonResponse({ error: 'Invalid type' }, 400);
  }

  const shape = (d) => shapes.list(d, type === 'all' ? undefined : type);
  return tmdbFetch(`/trending/${type}/week`, env, { ttl: 3600, shape, ctx: context });
}
