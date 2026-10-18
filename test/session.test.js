import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionCookie, hasValidSession, turnstileEnabled } from '../lib/session.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { onRequestPost as session } from '../functions/api/session.js';

const env = { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const cookieValue = (setCookie) => setCookie.split(';')[0];
const req = (url, init = {}) => new Request(url, { ...init, headers: { 'cf-connecting-ip': '5.5.5.5', ...init.headers } });
const okNext = async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });

test('Turnstile is only enabled when both keys are set', () => {
  assert.equal(turnstileEnabled({}), false);
  assert.equal(turnstileEnabled({ TURNSTILE_SECRET_KEY: 's' }), false);
  assert.equal(turnstileEnabled(env), true);
});

test('session cookies verify, and reject tampering, expiry and other keys', async () => {
  const set = await createSessionCookie(env);
  assert.match(set, /HttpOnly; Secure; SameSite=Strict/);
  const cookie = cookieValue(set);
  const withCookie = (c) => req('https://f.test/api/trending', { headers: { cookie: c } });

  assert.equal(await hasValidSession(withCookie(cookie), env), true);
  assert.equal(await hasValidSession(withCookie(`other=1; ${cookie}`), env), true);
  assert.equal(await hasValidSession(req('https://f.test/'), env), false);

  const [name, value] = cookie.split('=');
  const [exp, sig] = value.split('.');
  assert.equal(await hasValidSession(withCookie(`${name}=${Number(exp) + 999}.${sig}`), env), false);
  assert.equal(await hasValidSession(withCookie(cookie), { ...env, TURNSTILE_SECRET_KEY: 'rotated' }), false);
  assert.equal(await hasValidSession(withCookie(cookie), env, Date.now() + 13 * 3600 * 1000), false);
});

test('middleware requires a session only when Turnstile is configured', async () => {
  const open = await middleware({ request: req('https://f.test/api/trending'), env: {}, next: okNext });
  assert.equal(open.status, 200);

  const gated = await middleware({ request: req('https://f.test/api/trending'), env, next: okNext });
  assert.equal(gated.status, 401);
  assert.deepEqual(await gated.json(), { error: 'Verification required', challenge: 'site' });

  const cookie = cookieValue(await createSessionCookie(env));
  const passed = await middleware({ request: req('https://f.test/api/trending', { headers: { cookie } }), env, next: okNext });
  assert.equal(passed.status, 200);
});

test('middleware allows POST only on /api/session', async () => {
  const post = await middleware({ request: req('https://f.test/api/trending', { method: 'POST' }), env, next: okNext });
  assert.equal(post.status, 405);
  const get = await middleware({ request: req('https://f.test/api/session'), env, next: okNext });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  const sess = await middleware({ request: req('https://f.test/api/session', { method: 'POST' }), env, next: okNext });
  assert.equal(sess.status, 200);
});

test('/api/session sets the cookie only after Turnstile accepts the token', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init.body });
    const ok = init.body.get('response') === 'good';
    return new Response(JSON.stringify({ success: ok, 'error-codes': ok ? [] : ['invalid-input-response'] }));
  };
  const post = (body) => session({
    request: req('https://f.test/api/session', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    env,
  });

  assert.equal((await post({})).status, 400);
  const bad = await post({ token: 'bad' });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('set-cookie'), null);

  const good = await post({ token: 'good' });
  assert.equal(good.status, 200);
  assert.match(good.headers.get('set-cookie'), /^flix_s=/);
  assert.equal(calls.at(-1).url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(calls.at(-1).body.get('secret'), 'secret');
  assert.equal(calls.at(-1).body.get('remoteip'), '5.5.5.5');
});

test('/api/session is a no-op when Turnstile is not configured', async () => {
  const res = await session({ request: req('https://f.test/api/session', { method: 'POST', body: '{}' }), env: {} });
  assert.deepEqual(await res.json(), { ok: true, required: false });
});
