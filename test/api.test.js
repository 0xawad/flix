import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { shapes, tmdbFetch, validateInt } from '../lib/tmdb.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { onRequest as search } from '../functions/api/search.js';
import { onRequest as season } from '../functions/api/tv/[id]/season/[num].js';
import { onRequest as trending } from '../functions/api/trending.js';

const realFetch = globalThis.fetch;
let calls;

function mockTmdb(status = 200, body = { results: [] }) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

const env = { TMDB_API_KEY: 'v3key' };

function ctx(url, { method = 'GET', headers = {}, next, params = {}, ip = '1.1.1.1' } = {}) {
  return {
    request: new Request(url, { method, headers: { 'cf-connecting-ip': ip, ...headers } }),
    env,
    params,
    next: next || (async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })),
  };
}

// ─── lib/tmdb.js ───

test('validateInt accepts positive integers within bounds only', () => {
  assert.equal(validateInt('42'), 42);
  assert.equal(validateInt('0'), null);
  assert.equal(validateInt('-3'), null);
  assert.equal(validateInt('1.5'), null);
  assert.equal(validateInt('abc'), null);
  assert.equal(validateInt('501', 500), null);
});

test('list shape keeps only movies and tv with allowlisted fields', () => {
  const out = shapes.list({
    page: 2,
    total_pages: 9,
    results: [
      { id: 1, media_type: 'movie', title: 'A', overview: 'long', popularity: 9, poster_path: '/a.jpg' },
      { id: 2, media_type: 'person', name: 'P' },
      { id: 3, media_type: 'tv', name: 'B', first_air_date: '2020-01-01' },
    ],
  });
  assert.deepEqual(out, {
    page: 2,
    total_pages: 9,
    results: [
      { id: 1, media_type: 'movie', title: 'A', poster_path: '/a.jpg', overview: 'long' },
      { id: 3, media_type: 'tv', name: 'B', first_air_date: '2020-01-01', overview: '' },
    ],
  });
});

test('list shape fills media_type for typed lists and clips overviews', () => {
  const out = shapes.list({ results: [{ id: 1, title: 'A', overview: 'x'.repeat(400) }] }, 'movie');
  assert.equal(out.results[0].media_type, 'movie');
  assert.equal(out.results[0].overview.length, 280);
  assert.ok(out.results[0].overview.endsWith('…'));
});

test('season shape trims episodes', () => {
  const out = shapes.season({ season_number: 1, episodes: [{ episode_number: 1, name: 'Pilot', air_date: 'x', still_path: '/s.jpg', crew: [1, 2] }] });
  assert.deepEqual(out, { season_number: 1, episodes: [{ episode_number: 1, name: 'Pilot', air_date: 'x', still_path: '/s.jpg', overview: '' }] });
});

test('movie and tv shapes flatten genres to names', () => {
  const movie = shapes.movie({ id: 1, title: 'T', budget: 5, genres: [{ id: 1, name: 'Drama' }, { id: 2, name: 'Crime' }] });
  assert.deepEqual(movie, { id: 1, title: 'T', genres: ['Drama', 'Crime'] });
  const tv = shapes.tv({ id: 2, name: 'S', seasons: [{ season_number: 1, name: 'S1', episode_count: 3, air_date: 'x' }] });
  assert.deepEqual(tv, { id: 2, name: 'S', genres: [], seasons: [{ season_number: 1, name: 'S1', episode_count: 3 }] });
});

test('v3 keys go in the query string, v4 tokens in a Bearer header', async () => {
  mockTmdb();
  await tmdbFetch('/trending/all/week', { TMDB_API_KEY: 'v3key' });
  assert.match(calls[0].url, /\?api_key=v3key$/);

  await tmdbFetch('/search/multi?query=x', { TMDB_API_KEY: 'eyJtoken' });
  assert.ok(!calls[1].url.includes('api_key'));
  assert.equal(calls[1].init.headers.authorization, 'Bearer eyJtoken');
});

test('upstream errors are mapped and never relay the TMDB body', async () => {
  mockTmdb(401, { status_message: 'Invalid API key: secret details' });
  let res = await tmdbFetch('/x', env);
  assert.equal(res.status, 502);
  assert.ok(!(await res.text()).includes('secret'));

  mockTmdb(404, {});
  res = await tmdbFetch('/x', env);
  assert.equal(res.status, 404);

  mockTmdb(429, {});
  res = await tmdbFetch('/x', env);
  assert.equal(res.status, 503);
});

test('successful responses carry cache headers when a ttl is set', async () => {
  mockTmdb(200, { id: 1, title: 'T', budget: 5 });
  const res = await tmdbFetch('/movie/1', env, { ttl: 60, shape: shapes.movie });
  assert.match(res.headers.get('cache-control'), /max-age=60/);
  assert.deepEqual(await res.json(), { id: 1, title: 'T', genres: [] });
});

// ─── routes ───

test('search validates the query and page', async () => {
  mockTmdb();
  assert.equal((await search(ctx('https://f.test/api/search'))).status, 400);
  assert.equal((await search(ctx(`https://f.test/api/search?q=${'a'.repeat(101)}`))).status, 400);
  assert.equal((await search(ctx('https://f.test/api/search?q=x&page=0'))).status, 400);
  assert.equal((await search(ctx('https://f.test/api/search?q=x&page=501'))).status, 400);
  assert.equal(calls.length, 0);

  const res = await search(ctx('https://f.test/api/search?q=%20Dune%0A%20%20Part&page=2'));
  assert.equal(res.status, 200);
  assert.match(calls[0].url, /query=dune%20part&page=2&include_adult=false/);
});

test('trending accepts a media type', async () => {
  mockTmdb(200, { results: [{ id: 1, title: 'A' }] });
  assert.equal((await trending(ctx('https://f.test/api/trending?type=people'))).status, 400);
  const res = await trending(ctx('https://f.test/api/trending?type=movie'));
  assert.match(calls[0].url, /\/trending\/movie\/week/);
  assert.equal((await res.json()).results[0].media_type, 'movie');
  await trending(ctx('https://f.test/api/trending'));
  assert.match(calls[1].url, /\/trending\/all\/week/);
});

test('season route rejects bad ids', async () => {
  mockTmdb();
  const bad = await season(ctx('https://f.test/api/tv/x/season/1', { params: { id: 'x', num: '1' } }));
  assert.equal(bad.status, 400);
  const ok = await season(ctx('https://f.test/api/tv/1/season/2', { params: { id: '1', num: '2' } }));
  assert.equal(ok.status, 200);
  assert.match(calls[0].url, /\/tv\/1\/season\/2\?/);
});

test('search reports a missing key without leaking config', async () => {
  const res = await search({ ...ctx('https://f.test/api/search?q=x'), env: {} });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'Server is not configured' });
});

// ─── middleware ───

test('middleware allows only GET and HEAD', async () => {
  const res = await middleware(ctx('https://f.test/api/trending', { method: 'POST' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
});

test('middleware rejects cross-site browser requests', async () => {
  let res = await middleware(ctx('https://f.test/api/trending', { headers: { 'sec-fetch-site': 'cross-site' } }));
  assert.equal(res.status, 403);
  res = await middleware(ctx('https://f.test/api/trending', { headers: { origin: 'https://evil.test' } }));
  assert.equal(res.status, 403);
  res = await middleware(ctx('https://f.test/api/trending', { headers: { 'sec-fetch-site': 'same-origin', origin: 'https://f.test' } }));
  assert.equal(res.status, 200);
});

test('middleware turns the SPA fallback into a JSON 404', async () => {
  const res = await middleware(ctx('https://f.test/api/nope', {
    next: async () => new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' } }),
  }));
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

test('middleware adds security headers and no-store on errors', async () => {
  const res = await middleware(ctx('https://f.test/api/x', {
    next: async () => new Response('{"error":"bad"}', { status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } }),
  }));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('middleware converts thrown errors into a JSON 500', async () => {
  const res = await middleware(ctx('https://f.test/api/x', { next: async () => { throw new Error('boom'); } }));
  assert.equal(res.status, 500);
});

test('middleware rate-limits search per client', async () => {
  const statuses = [];
  for (let i = 0; i < 31; i++) {
    const res = await middleware(ctx('https://f.test/api/search?q=a', { ip: '9.9.9.9' }));
    statuses.push(res.status);
  }
  assert.equal(statuses.filter((s) => s === 200).length, 30);
  assert.equal(statuses.at(-1), 429);

  const other = await middleware(ctx('https://f.test/api/search?q=a', { ip: '8.8.8.8' }));
  assert.equal(other.status, 200);
});

test('middleware prefers the RATE_LIMITER binding when present', async () => {
  const c = ctx('https://f.test/api/trending', { ip: '7.7.7.7' });
  c.env = { ...env, RATE_LIMITER: { limit: async ({ key }) => ({ success: key !== 'default:7.7.7.7' }) } };
  assert.equal((await middleware(c)).status, 429);
});
