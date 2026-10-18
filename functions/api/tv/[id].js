import { checkApiKey, jsonResponse, tmdbFetch, validateInt, shapes } from '../../../lib/tmdb.js';

export async function onRequest(context) {
  const { env, params } = context;

  const keyErr = checkApiKey(env);
  if (keyErr) return keyErr;

  const id = validateInt(params.id);
  if (!id) {
    return jsonResponse({ error: 'Invalid series ID' }, 400);
  }

  return tmdbFetch(`/tv/${id}`, env, { ttl: 21600, shape: shapes.tv, ctx: context });
}
