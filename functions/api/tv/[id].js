const TMDB_BASE = 'https://api.themoviedb.org/3';

export async function onRequest(context) {
  const { env, params } = context;
  const id = params.id;
  const key = env.TMDB_API_KEY;

  if (!key) {
    return new Response(JSON.stringify({
      error: 'TMDB_API_KEY not set. Add it in Cloudflare Pages dashboard → Environment variables.'
    }), { status: 500, headers: { 'content-type': 'application/json' } });
  }

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing series ID' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  const tmdbRes = await fetch(
    `${TMDB_BASE}/tv/${id}?api_key=${key}`,
    { headers: { accept: 'application/json' } }
  );

  if (!tmdbRes.ok) {
    const txt = await tmdbRes.text();
    return new Response(txt, {
      status: tmdbRes.status, headers: { 'content-type': 'application/json' },
    });
  }

  const data = await tmdbRes.json();
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
}
