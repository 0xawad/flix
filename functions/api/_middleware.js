import { jsonResponse } from '../../lib/tmdb.js';
import { hasValidSession, turnstileEnabled } from '../../lib/session.js';

// Runs in front of every /api/* request (including paths with no route).

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

// Requests per client per minute. Search is the expensive, scriptable one.
const LIMITS = { search: 30, session: 10, default: 120 };
const WINDOW_MS = 60_000;

// Best-effort fallback limiter, per isolate. Many isolates serve the site, so
// this only slows down a single noisy client; the RATE_LIMITER binding or a
// Cloudflare WAF rate-limiting rule is the real control.
const hits = new Map();

function localLimit(key, limit) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start >= WINDOW_MS) {
    if (hits.size > 5000) hits.clear();
    hits.set(key, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

async function allowed(env, ip, bucket) {
  if (env.RATE_LIMITER) {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: `${bucket}:${ip}` });
      return success;
    } catch (err) {
      console.error('RATE_LIMITER failed', err);
    }
  }
  return localLimit(`${bucket}:${ip}`, LIMITS[bucket] ?? LIMITS.default);
}

function isCrossSite(request, url) {
  // Browsers send Sec-Fetch-Site; "none" means the user opened the URL directly.
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('origin');
  return origin != null && origin !== url.origin;
}

function withHeaders(response, extra = {}) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) {
    res.headers.set(k, v);
  }
  if (!res.headers.has('cache-control') || res.status !== 200) {
    res.headers.set('cache-control', 'no-store');
  }
  res.headers.delete('access-control-allow-origin');
  return res;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const isSession = url.pathname === '/api/session';
  const methods = isSession ? ['POST'] : ['GET', 'HEAD'];
  if (!methods.includes(request.method)) {
    return withHeaders(jsonResponse({ error: 'Method not allowed' }, 405), { allow: methods.join(', ') });
  }

  if (isCrossSite(request, url)) {
    return withHeaders(jsonResponse({ error: 'Forbidden' }, 403));
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const bucket = isSession ? 'session' : url.pathname === '/api/search' ? 'search' : 'default';
  if (!(await allowed(env, ip, bucket))) {
    return withHeaders(jsonResponse({ error: 'Too many requests' }, 429), { 'retry-after': '60' });
  }

  // With Turnstile configured, every data route needs a session cookie. The
  // 401 carries the public site key so the client can render the challenge.
  if (!isSession && turnstileEnabled(env) && !(await hasValidSession(request, env))) {
    return withHeaders(jsonResponse({ error: 'Verification required', challenge: env.TURNSTILE_SITE_KEY }, 401));
  }

  let response;
  try {
    response = await context.next();
  } catch (err) {
    console.error('Unhandled API error', url.pathname, err);
    response = jsonResponse({ error: 'Internal error' }, 500);
  }

  // No function matched, so Pages fell through to the SPA's index.html.
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    response = jsonResponse({ error: 'Not found' }, 404);
  }

  return withHeaders(response);
}
