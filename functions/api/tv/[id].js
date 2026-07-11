import { checkApiKey, jsonResponse, tmdbFetch, validateInt } from '../_middleware.js';

export async function onRequest(context) {
  const { env, params } = context;

  const keyErr = checkApiKey(env);
  if (keyErr) return keyErr;

  const id = validateInt(params.id);
  if (!id) {
    return jsonResponse({ error: 'Invalid series ID' }, 400);
  }

  return tmdbFetch(`/tv/${id}?api_key=${env.TMDB_API_KEY}`);
}
