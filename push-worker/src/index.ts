// R&M News app server (Cloudflare Workers free plan).
//   POST /subscribe, /unsubscribe     breaking-news alerts (KV)
//   POST /hit, GET /trending          anonymous usage counts and "Trending in app" (D1)
//   GET  /a/<id>                      share preview page that opens the story in the app
//   GET  /site/config                 Editor's Pick and announcement banner for the app
//   GET  /market/*                    Nifty Realty list and news behind stock moves
//   /editor/*                         Content Studio (owner key or an editor key)
//   GET  /stats?key=…                 private stats page for the owner
//   cron every 10 minutes             new-story alerts, website uptime check, 9 AM morning brief
import { checkAndNotify, subKey, subscribe } from './push.ts'
import { sharePage } from './share.ts'
import { parseHit, recordHit, statsPage, trending } from './stats.ts'
import { ideas, keywords, overview, SEEDS, seoAudit } from './editor.ts'
import { competitors } from './competitors.ts'
import { marketNews, niftyRealty } from './market.ts'
import {
  authenticate,
  checkSite,
  createEditor,
  customPush,
  deleteIdea,
  listEditors,
  listIdeas,
  morningBrief,
  performance,
  pushLog,
  registerOwnerDevice,
  revokeEditor,
  sameKey,
  saveIdea,
  saveSiteConfig,
  siteConfig,
  uptimeSummary,
  type Who,
} from './owner.ts'
import { checkIn, checkOut, myHistory, myToday, registerStaffDevice, reportReminders, saveTeamSettings, submitReport, teamDay, teamMonth } from './team.ts'

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
// Bump when studio/market logic changes, so old cached results are not served.
const STUDIO_CACHE = 5

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
  return text ? JSON.parse(text) : {}
}

/** Serves `make()` from the edge cache for `ttl` seconds (cache key never includes a key or user). */
async function cachedJson(url: URL, ctx: ExecutionContext, headers: Record<string, string>, ttl: number, make: () => Promise<unknown>) {
  const key = new Request(`${url.origin}${url.pathname}${url.search}${url.search ? '&' : '?'}v=${STUDIO_CACHE}`)
  const hit = await caches.default.match(key)
  if (hit) return new Response(hit.body, { headers: { ...Object.fromEntries(hit.headers), ...headers } })
  const res = json(await make(), 200, { 'Cache-Control': `public, max-age=${ttl}` })
  ctx.waitUntil(caches.default.put(key, res.clone()))
  return new Response(res.body, { headers: { ...Object.fromEntries(res.headers), ...headers } })
}

/** Content Studio for the owner and editors. Team management is owner-only. */
async function studio(req: Request, url: URL, env: Env, ctx: ExecutionContext, headers: Record<string, string>, who: Who): Promise<Response> {
  const { pathname } = url
  const ownerOnly = () => json({ error: 'Only the owner can do this.' }, 403, headers)
  try {
    if (req.method === 'GET') {
      switch (pathname) {
        case '/editor/ping':
          return json({ ok: true, role: who.role, name: who.name }, 200, headers)
        case '/editor/overview':
          return json(await overview(env), 200, headers)
        case '/editor/ideas':
          return cachedJson(url, ctx, headers, 30 * 60, () => ideas(env))
        case '/editor/keywords': {
          const seeds = (url.searchParams.get('seeds') ?? '')
            .split(',')
            .map((s) => s.trim().toLowerCase().slice(0, 60))
            .filter(Boolean)
          return cachedJson(url, ctx, headers, 12 * 60 * 60, () => keywords(seeds.length ? seeds : SEEDS))
        }
        case '/editor/competitors':
          return cachedJson(url, ctx, headers, 60 * 60, () => competitors(env))
        case '/editor/seo':
          return cachedJson(url, ctx, headers, 6 * 60 * 60, () => seoAudit(env))
        case '/editor/push-log':
          return json(await pushLog(env), 200, headers)
        case '/editor/uptime':
          return json(await uptimeSummary(env), 200, headers)
        case '/editor/performance': {
          const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days')) || 7))
          return json(await performance(env, days), 200, headers)
        }
        case '/editor/calendar':
          return json(await listIdeas(env), 200, headers)
        case '/editor/site':
          return json(await siteConfig(env), 200, headers)
        case '/editor/team':
          return who.role === 'owner' ? json({ editors: await listEditors(env) }, 200, headers) : ownerOnly()
        case '/editor/me/today':
          return json(await myToday(env, who), 200, headers)
        case '/editor/me/history':
          return json(await myHistory(env, who), 200, headers)
        case '/editor/team/day':
          return who.role === 'owner' ? json(await teamDay(env, url.searchParams.get('date') ?? ''), 200, headers) : ownerOnly()
        case '/editor/team/month':
          return who.role === 'owner' ? json(await teamMonth(env, url.searchParams.get('month') ?? ''), 200, headers) : ownerOnly()
      }
      return json({ error: 'not found' }, 404, headers)
    }

    const body = await readJson(req)
    switch (pathname) {
      case '/editor/push':
        return json(await customPush(env, body, who), 200, headers)
      case '/editor/site':
        return json(await saveSiteConfig(env, body), 200, headers)
      case '/editor/owner-device':
        return json({ ok: await registerOwnerDevice(env, body, who) }, 200, headers)
      case '/editor/calendar':
        return json(await saveIdea(env, body, who), 200, headers)
      case '/editor/calendar/delete':
        return json({ ok: await deleteIdea(env, Number((body as { id?: unknown }).id)) }, 200, headers)
      case '/editor/brief-now':
        return who.role === 'owner' ? json({ result: await morningBrief(env, true) }, 200, headers) : ownerOnly()
      case '/editor/team': {
        if (who.role !== 'owner') return ownerOnly()
        const name = String((body as { name?: unknown }).name ?? '')
        return json(await createEditor(env, name), 200, headers)
      }
      case '/editor/me/checkin':
        return json(await checkIn(env, who, body), 200, headers)
      case '/editor/me/checkout':
        return json(await checkOut(env, who), 200, headers)
      case '/editor/me/report':
        return json(await submitReport(env, who, body), 200, headers)
      case '/editor/me/device':
        return json({ ok: await registerStaffDevice(env, who, body) }, 200, headers)
      case '/editor/team/settings':
        return who.role === 'owner' ? json(await saveTeamSettings(env, body), 200, headers) : ownerOnly()
      case '/editor/team/remind-now':
        return who.role === 'owner' ? json({ result: await reportReminders(env, true) }, 200, headers) : ownerOnly()
      case '/editor/team/revoke':
        return who.role === 'owner' ? json({ ok: await revokeEditor(env, String((body as { id?: unknown }).id ?? '')) }, 200, headers) : ownerOnly()
    }
    return json({ error: 'not found' }, 404, headers)
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

    if (pathname.startsWith('/editor/')) {
      if (req.method !== 'GET' && !headers['Access-Control-Allow-Origin']) return json({ error: 'not allowed' }, 403, headers)
      const key = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
      const who = await authenticate(key, env, ctx)
      if (!who) return json({ error: 'owner or editor key required' }, 401, headers)
      return studio(req, url, env, ctx, headers, who)
    }

    if (req.method === 'GET') {
      if (pathname === '/') return json({ ok: true, service: 'R&M News app server' }, 200, headers)
      if (pathname === '/vapid') return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, headers)
      const share = /^\/a\/(\d{1,9})$/.exec(pathname)
      if (share) return sharePage(env, Number(share[1]))
      if (pathname === '/site/config') return json(await siteConfig(env), 200, { ...headers, 'Cache-Control': 'public, max-age=60' })
      if (pathname === '/market/nifty-realty') return cachedJson(url, ctx, headers, 86400, () => niftyRealty())
      if (pathname === '/market/news') return cachedJson(url, ctx, headers, 1800, () => marketNews(env))
      if (pathname === '/trending') return cachedJson(url, ctx, headers, 300, async () => ({ items: await trending(env).catch(() => []) }))
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
    const run = (name: string, job: () => Promise<string>) => job().then((r) => console.log(name, r), (e) => console.log(name, 'failed', (e as Error).message))
    ctx.waitUntil(Promise.all([run('alerts', () => checkAndNotify(env)), run('uptime', () => checkSite(env)), run('brief', () => morningBrief(env)), run('reminders', () => reportReminders(env))]))
  },
} satisfies ExportedHandler<Env>
