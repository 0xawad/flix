import { checkApiKey, tmdbFetch } from './_middleware.js';

export async function onRequest(context) {
  const { env } = context;

  const keyErr = checkApiKey(env);
  if (keyErr) return keyErr;

  return tmdbFetch(`/trending/all/week?api_key=${env.TMDB_API_KEY}`);
}
