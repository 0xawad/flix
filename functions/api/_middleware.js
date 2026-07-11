const TMDB_BASE = 'https://api.themoviedb.org/3';

export function validateInt(val) {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function checkApiKey(env) {
  if (!env.TMDB_API_KEY) {
    return jsonResponse(
      { error: 'TMDB_API_KEY not set. Add it in Cloudflare Pages dashboard → Environment variables.' },
      500
    );
  }
  return null;
}

export async function tmdbFetch(path) {
  const res = await fetch(`${TMDB_BASE}${path}`, {
    headers: { accept: 'application/json' },
  });

  if (!res.ok) {
    let body;
    try {
      body = await res.json();
    } catch {
      body = { error: `TMDB returned status ${res.status}` };
    }
    return jsonResponse(body, res.status);
  }

  const data = await res.json();
  return jsonResponse(data);
}
