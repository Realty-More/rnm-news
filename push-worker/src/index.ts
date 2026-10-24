// R&M News app server (Cloudflare Workers free plan).
//   POST /subscribe, /unsubscribe  breaking-news alerts (KV)
//   POST /hit, GET /trending       anonymous usage counts and "Trending in app" (D1)
//   GET  /a/<id>                   share preview page that opens the story in the app
//   GET  /stats?key=…              private stats page for the company
//   cron every 10 minutes          notify subscribed devices about new realtynmore.com posts
import { checkAndNotify, subKey, subscribe } from './push.ts'
import { sharePage } from './share.ts'
import { parseHit, recordHit, statsPage, trending } from './stats.ts'
import { ideas, keywords, overview, SEEDS, seoAudit } from './editor.ts'
import { competitors } from './competitors.ts'

export interface Env {
  SUBS: KVNamespace
  DB: D1Database
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  ALLOWED_ORIGINS: string
  SITE_API: string
  APP_URL: string
  STATS_KEY: string
}

export { buildNotices, isValidSubscription, matching, newSince } from './push.ts'
export type { NewsItem } from './site.ts'

const MAX_BODY = 4096
const STUDIO_CACHE = 2

function cors(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  return origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', Vary: 'Origin' }
    : {}
}

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text()
  if (text.length > MAX_BODY) throw new Error('too large')
  return JSON.parse(text)
}

/** Constant-time compare for the stats key. */
function sameKey(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Owner-only Content Studio data; slow sources are cached (cache key never includes the owner key). */
async function editor(pathname: string, url: URL, env: Env, ctx: ExecutionContext, headers: Record<string, string>): Promise<Response> {
  const cached = async (ttl: number, make: () => Promise<unknown>) => {
    // Bump STUDIO_CACHE when the studio logic changes, so old cached results are not served.
    const key = new Request(`${url.origin}${pathname}${url.search}${url.search ? '&' : '?'}v=${STUDIO_CACHE}`)
    const hit = await caches.default.match(key)
    if (hit) return new Response(hit.body, { headers: { ...Object.fromEntries(hit.headers), ...headers } })
    const res = json(await make(), 200, { 'Cache-Control': `public, max-age=${ttl}` })
    ctx.waitUntil(caches.default.put(key, res.clone()))
    return new Response(res.body, { headers: { ...Object.fromEntries(res.headers), ...headers } })
  }
  try {
    switch (pathname) {
      case '/editor/ping':
        return json({ ok: true }, 200, headers)
      case '/editor/overview':
        return json(await overview(env), 200, headers)
      case '/editor/ideas':
        return cached(30 * 60, () => ideas(env))
      case '/editor/keywords': {
        const seeds = (url.searchParams.get('seeds') ?? '')
          .split(',')
          .map((s) => s.trim().toLowerCase().slice(0, 60))
          .filter(Boolean)
        return cached(12 * 60 * 60, () => keywords(seeds.length ? seeds : SEEDS))
      }
      case '/editor/competitors':
        return cached(60 * 60, () => competitors(env))
      case '/editor/seo':
        return cached(6 * 60 * 60, () => seoAudit(env))
      default:
        return json({ error: 'not found' }, 404, headers)
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 502, headers)
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    const { pathname } = url
    const origin = req.headers.get('Origin')
    const headers = cors(origin, env)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

    if (req.method === 'GET') {
      if (pathname === '/') return json({ ok: true, service: 'R&M News app server' }, 200, headers)
      if (pathname === '/vapid') return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, headers)
      const share = /^\/a\/(\d{1,9})$/.exec(pathname)
      if (share) return sharePage(env, Number(share[1]))
      if (pathname === '/trending') {
        const cache = caches.default
        const key = new Request(`${url.origin}/trending`)
        const hit = await cache.match(key)
        if (hit) return new Response(hit.body, { headers: { ...Object.fromEntries(hit.headers), ...headers } })
        const items = await trending(env).catch(() => [])
        const res = json({ items }, 200, { 'Cache-Control': 'public, max-age=300' })
        ctx.waitUntil(cache.put(key, res.clone()))
        return new Response(res.body, { headers: { ...Object.fromEntries(res.headers), ...headers } })
      }
      if (pathname.startsWith('/editor/')) {
        const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
        if (!sameKey(auth, env.STATS_KEY ?? '')) return json({ error: 'owner key required' }, 401, headers)
        return editor(pathname, url, env, ctx, headers)
      }
      if (pathname === '/stats') {
        if (!sameKey(url.searchParams.get('key') ?? '', env.STATS_KEY ?? '')) return new Response('Not found', { status: 404 })
        return new Response(await statsPage(env), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
      }
      return json({ error: 'not found' }, 404, headers)
    }

    if (req.method !== 'POST' || !headers['Access-Control-Allow-Origin']) return json({ error: 'not allowed' }, 403, headers)
    let body: unknown
    try {
      body = await readJson(req)
    } catch {
      return json({ error: 'bad request' }, 400, headers)
    }

    if (pathname === '/subscribe') {
      return (await subscribe(env, body)) ? json({ ok: true }, 200, headers) : json({ error: 'invalid subscription' }, 400, headers)
    }
    if (pathname === '/unsubscribe') {
      const endpoint = (body as { endpoint?: unknown }).endpoint
      if (typeof endpoint !== 'string') return json({ error: 'bad request' }, 400, headers)
      await env.SUBS.delete(await subKey(endpoint))
      return json({ ok: true }, 200, headers)
    }
    if (pathname === '/hit') {
      const hit = parseHit(body)
      if (!hit) return json({ error: 'bad request' }, 400, headers)
      ctx.waitUntil(recordHit(env, hit).catch(() => {}))
      return json({ ok: true }, 200, headers)
    }
    return json({ error: 'not found' }, 404, headers)
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(checkAndNotify(env).then((r) => console.log(r)))
  },
} satisfies ExportedHandler<Env>
