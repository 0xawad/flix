const TMDB_BASE = 'https://api.themoviedb.org/3';

export async function onRequest(context) {
  const { env, params } = context;
  const id = params.id;
  const num = params.num;

  if (!id || !num) {
    return new Response(JSON.stringify({ error: 'Missing series ID or season number' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const tmdbRes = await fetch(
    `${TMDB_BASE}/tv/${id}/season/${num}?api_key=${env.TMDB_API_KEY}`,
    { headers: { accept: 'application/json' } }
  );

  if (!tmdbRes.ok) {
    return new Response(JSON.stringify({ error: 'TMDB request failed' }), {
      status: tmdbRes.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const data = await tmdbRes.json();

  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
}
