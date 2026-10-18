import { checkApiKey, jsonResponse, tmdbFetch, validateInt, shapes } from '../../../lib/tmdb.js';

export async function onRequest(context) {
  const { env, params } = context;

  const keyErr = checkApiKey(env);
  if (keyErr) return keyErr;

  const id = validateInt(params.id);
  if (!id) {
    return jsonResponse({ error: 'Invalid movie ID' }, 400);
  }

  return tmdbFetch(`/movie/${id}`, env, { ttl: 21600, shape: shapes.movie, ctx: context });
}
