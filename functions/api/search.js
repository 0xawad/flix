import { checkApiKey, jsonResponse, tmdbFetch, validateInt } from '../../lib/tmdb.js';

const MAX_QUERY = 100;

export async function onRequest(context) {
  const { request, env } = context;

  const keyErr = checkApiKey(env);
  if (keyErr) return keyErr;

  const url = new URL(request.url);
  // Collapse whitespace and drop control characters before forwarding.
  const query = (url.searchParams.get('q') || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!query) {
    return jsonResponse({ error: 'Missing ?q=' }, 400);
  }
  if (query.length > MAX_QUERY) {
    return jsonResponse({ error: `Query too long (max ${MAX_QUERY} characters)` }, 400);
  }

  const pageParam = url.searchParams.get('page');
  const page = pageParam == null ? 1 : validateInt(pageParam, 500);
  if (!page) {
    return jsonResponse({ error: 'Invalid page' }, 400);
  }

  return tmdbFetch(
    `/search/multi?query=${encodeURIComponent(query)}&page=${page}&include_adult=false`,
    env,
    { ttl: 600 }
  );
}
