import { checkApiKey, tmdbFetch, shapes } from '../../lib/tmdb.js';

export async function onRequest(context) {
  const { env } = context;

  const keyErr = checkApiKey(env);
  if (keyErr) return keyErr;

  return tmdbFetch('/trending/all/week', env, { ttl: 3600, shape: shapes.list, ctx: context });
}
