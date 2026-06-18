const TMDB_BASE = 'https://api.themoviedb.org/3';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query parameter ?q=' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const tmdbRes = await fetch(
    `${TMDB_BASE}/search/multi?query=${encodeURIComponent(query)}&api_key=${env.TMDB_API_KEY}`,
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
