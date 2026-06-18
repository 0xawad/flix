const TMDB_BASE = 'https://api.themoviedb.org/3';

export async function onRequest(context) {
  const { env } = context;
  const key = env.TMDB_API_KEY;

  if (!key) {
    return new Response(JSON.stringify({
      error: 'TMDB_API_KEY not set.'
    }), { status: 500, headers: { 'content-type': 'application/json' } });
  }

  const res = await fetch(
    `${TMDB_BASE}/trending/all/week?api_key=${key}`,
    { headers: { accept: 'application/json' } }
  );

  if (!res.ok) {
    const txt = await res.text();
    return new Response(txt, {
      status: res.status, headers: { 'content-type': 'application/json' },
    });
  }

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
}
