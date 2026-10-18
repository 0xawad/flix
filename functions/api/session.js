import { jsonResponse } from '../../lib/tmdb.js';
import { createSessionCookie, turnstileEnabled, verifyTurnstile } from '../../lib/session.js';

// POST /api/session  { "token": "<turnstile response>" }  →  sets the session cookie
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!turnstileEnabled(env)) {
    return jsonResponse({ ok: true, required: false });
  }

  const length = Number(request.headers.get('content-length') || 0);
  if (length > 4096) return jsonResponse({ error: 'Request too large' }, 413);

  let token;
  try {
    ({ token } = await request.json());
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return jsonResponse({ error: 'Missing token' }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip');
  if (!(await verifyTurnstile(token, ip, env))) {
    return jsonResponse({ error: 'Verification failed' }, 403);
  }

  return jsonResponse({ ok: true }, 200, { 'set-cookie': await createSessionCookie(env) });
}
