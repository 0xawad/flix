import { checkApiKey, jsonResponse, tmdbFetch } from './_middleware.js';

export async function onRequest(context) {
  const { request, env } = context;

  const keyErr = checkApiKey(env);
  if (keyErr) return keyErr;

  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  if (!query) {
    return jsonResponse({ error: 'Missing ?q=' }, 400);
  }

  return tmdbFetch(`/search/multi?query=${encodeURIComponent(query)}&api_key=${env.TMDB_API_KEY}`);
}
