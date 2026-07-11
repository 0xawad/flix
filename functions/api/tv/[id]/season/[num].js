import { checkApiKey, jsonResponse, tmdbFetch, validateInt } from '../../../_middleware.js';

export async function onRequest(context) {
  const { env, params } = context;

  const keyErr = checkApiKey(env);
  if (keyErr) return keyErr;

  const id = validateInt(params.id);
  const num = validateInt(params.num);
  if (!id || !num) {
    return jsonResponse({ error: 'Invalid series ID or season number' }, 400);
  }

  return tmdbFetch(`/tv/${id}/season/${num}?api_key=${env.TMDB_API_KEY}`);
}
