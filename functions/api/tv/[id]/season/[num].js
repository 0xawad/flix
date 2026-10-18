import { checkApiKey, jsonResponse, tmdbFetch, validateInt } from '../../../../../lib/tmdb.js';

export async function onRequest(context) {
  const { env, params } = context;

  const keyErr = checkApiKey(env);
  if (keyErr) return keyErr;

  const id = validateInt(params.id);
  const num = validateInt(params.num, 500);
  if (!id || !num) {
    return jsonResponse({ error: 'Invalid series ID or season number' }, 400);
  }

  return tmdbFetch(`/tv/${id}/season/${num}`, env, { ttl: 21600 });
}
