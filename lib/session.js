// Turnstile-backed API sessions. A visitor solves Turnstile once, POSTs the
// token to /api/session, and gets a signed, HttpOnly cookie that the /api
// middleware checks on every request. Scripts without a browser can't get one.
//
// Enforcement is off unless TURNSTILE_SECRET_KEY is set, so deploying this
// code changes nothing until the keys are configured.

const COOKIE = 'flix_s';
const TTL_SECONDS = 12 * 60 * 60;
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const enc = new TextEncoder();

export function turnstileEnabled(env) {
  return Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY);
}

function toB64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// SESSION_SECRET is optional; without it the key is derived from the
// Turnstile secret, so rotating that secret also invalidates sessions.
function hmacKey(env) {
  const secret = env.SESSION_SECRET || `flix-session:${env.TURNSTILE_SECRET_KEY}`;
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSessionCookie(env, now = Date.now()) {
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(String(exp)));
  const value = `${exp}.${toB64url(sig)}`;
  return `${COOKIE}=${value}; Path=/api; Max-Age=${TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(request) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

export async function hasValidSession(request, env, now = Date.now()) {
  const value = readCookie(request);
  if (!value) return false;
  const [expStr, sig] = value.split('.');
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || !sig || exp * 1000 <= now) return false;
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64url(sig), enc.encode(expStr));
  } catch {
    return false;
  }
}

export async function verifyTurnstile(token, ip, env) {
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (!data.success) console.error('Turnstile rejected', data['error-codes']);
    return data.success === true;
  } catch (err) {
    console.error('Turnstile siteverify failed', err);
    return false;
  }
}
