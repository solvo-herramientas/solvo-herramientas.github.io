/**
 * Buscador 3D · servidor intermedio (Cloudflare Worker)
 *
 * GET /search?source=thingiverse|cults&q=texto&page=1
 *   → { items: Resultado[], hasMore: boolean }
 *
 * Resultado = { id, title, author, url, thumb, likes, downloads,
 *               price (0 = gratis), currency, date (ms), tags[] }
 *
 * Solo usa las API oficiales de cada sitio, con claves guardadas como
 * secretos del Worker. Las respuestas se guardan 15 minutos en caché para
 * no repetir consultas y respetar los límites de cada sitio.
 */

const PER_PAGE = 20;
const CACHE_SECONDS = 900;
const UA = 'SOLVO-Buscador3D/1.0 (+https://solvo-herramientas.github.io/buscador-3d/)';

const ADAPTERS = {
  thingiverse: searchThingiverse,
  cults: searchCults,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname !== '/search' || request.method !== 'GET') return json({ error: 'not_found' }, 404, cors);

    const source = url.searchParams.get('source');
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const page = Math.min(Math.max(parseInt(url.searchParams.get('page')) || 1, 1), 20);
    if (!ADAPTERS[source]) return json({ error: 'unknown_source' }, 400, cors);
    if (!q) return json({ items: [], hasMore: false }, 200, cors);

    // Caché compartida por consulta normalizada
    const cacheKey = new Request(`https://cache.local/${source}/${page}/${encodeURIComponent(q.toLowerCase())}`);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return withHeaders(hit, cors);

    try {
      const data = await ADAPTERS[source](q, page, env);
      const res = json(data, 200, { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return withHeaders(res, cors);
    } catch (err) {
      console.error(source, err.message);
      const status = err.status === 429 ? 429 : 502;
      return json({ error: 'upstream_error', source }, status, cors);
    }
  },
};

/* ---------------- Thingiverse (API REST oficial) ---------------- */
async function searchThingiverse(q, page, env) {
  if (!env.THINGIVERSE_TOKEN) throw Object.assign(new Error('Falta THINGIVERSE_TOKEN'), { status: 500 });
  const api = `https://api.thingiverse.com/search/${encodeURIComponent(q)}/?type=things&sort=relevant&page=${page}&per_page=${PER_PAGE}`;
  const r = await fetch(api, { headers: { Authorization: `Bearer ${env.THINGIVERSE_TOKEN}`, 'User-Agent': UA } });
  if (!r.ok) throw Object.assign(new Error(`Thingiverse ${r.status}`), { status: r.status });
  const data = await r.json();
  const hits = Array.isArray(data) ? data : data.hits || [];
  const total = data.total ?? null;
  return {
    items: hits.map(t => ({
      id: `thingiverse-${t.id}`,
      title: t.name,
      author: t.creator?.name || '',
      url: t.public_url || `https://www.thingiverse.com/thing:${t.id}`,
      thumb: t.preview_image || t.thumbnail || null,
      likes: t.like_count ?? null,
      downloads: t.download_count ?? null,
      price: 0,
      currency: 'USD',
      date: t.created_at ? Date.parse(t.created_at) : null,
      tags: [],
    })),
    hasMore: total != null ? page * PER_PAGE < total : hits.length === PER_PAGE,
  };
}

/* ---------------- Cults3D (API GraphQL oficial) ----------------
   Autenticación HTTP Basic con usuario + clave de API. */
const CULTS_QUERY = `
query Buscar($q: String!, $limit: Int!, $offset: Int!) {
  creationsSearchBatch(query: $q, limit: $limit, offset: $offset) {
    total
    results {
      identifier
      name(locale: ES)
      url(locale: ES)
      illustrationImageUrl
      price(currency: USD) { cents }
      creator { nick }
      likesCount
      downloadsCount
      publishedAt
      tags(locale: ES)
    }
  }
}`;

async function searchCults(q, page, env) {
  if (!env.CULTS_USER || !env.CULTS_KEY) throw Object.assign(new Error('Faltan CULTS_USER / CULTS_KEY'), { status: 500 });
  const r = await fetch('https://cults3d.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + btoa(`${env.CULTS_USER}:${env.CULTS_KEY}`),
      'User-Agent': UA,
    },
    body: JSON.stringify({ query: CULTS_QUERY, variables: { q, limit: PER_PAGE, offset: (page - 1) * PER_PAGE } }),
  });
  if (!r.ok) throw Object.assign(new Error(`Cults ${r.status}`), { status: r.status });
  const { data, errors } = await r.json();
  if (errors?.length) throw new Error('Cults GraphQL: ' + errors.map(e => e.message).join('; '));
  const batch = data.creationsSearchBatch;
  return {
    items: batch.results.map(c => ({
      id: `cults-${c.identifier}`,
      title: c.name,
      author: c.creator?.nick || '',
      url: c.url,
      thumb: c.illustrationImageUrl || null,
      likes: c.likesCount ?? null,
      downloads: c.downloadsCount ?? null,
      price: c.price ? c.price.cents / 100 : 0,
      currency: 'USD',
      date: c.publishedAt ? Date.parse(c.publishedAt) : null,
      tags: (c.tags || []).slice(0, 3),
    })),
    hasMore: page * PER_PAGE < (batch.total ?? 0),
  };
}

/* ---------------- utilidades ---------------- */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', Vary: 'Origin' }
    : { Vary: 'Origin' };
}
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
function withHeaders(res, extra) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}
