// R&M News push server (Cloudflare Workers free plan).
// - POST /subscribe, POST /unsubscribe: the app registers or removes a device.
// - Cron every 10 minutes: checks realtynmore.com for new posts and notifies subscribed devices.
// Only post titles, links and images that are already public on realtynmore.com are sent.
import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push'

export interface Env {
  SUBS: KVNamespace
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  ALLOWED_ORIGINS: string
  SITE_API: string
}

export interface NewsItem {
  id: number
  title: string
  image?: string
}

const LAST_KEY = 'state:last-post'
const SUB_PREFIX = 'sub:'
const MAX_BODY = 4096
const MAX_SINGLE = 3 // more new posts than this become one summary notification

// Only real browser push services, so the worker can't be used to call arbitrary URLs.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/]

export function isValidSubscription(s: unknown): s is PushSubscription {
  if (!s || typeof s !== 'object') return false
  const sub = s as Partial<PushSubscription>
  if (typeof sub.endpoint !== 'string' || sub.endpoint.length > 1024) return false
  let url: URL
  try {
    url = new URL(sub.endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return false
  const k = sub.keys
  return !!k && typeof k.p256dh === 'string' && typeof k.auth === 'string' && k.p256dh.length < 200 && k.auth.length < 100
}

async function subKey(endpoint: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return SUB_PREFIX + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function cors(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  return origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
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

/* ---------- new posts ---------- */
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')

interface RawPost {
  id: number
  title: { rendered: string }
  _embedded?: { 'wp:featuredmedia'?: { source_url?: string; media_details?: { sizes?: Record<string, { source_url: string }> } }[] }
}

export async function fetchLatest(env: Env): Promise<NewsItem[]> {
  const url = `${env.SITE_API}/posts?per_page=10&_embed=wp:featuredmedia&_fields=id,title,_links,_embedded`
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'RM-News-Push/1.0' } })
  if (!res.ok) throw new Error(`site returned ${res.status}`)
  const posts = (await res.json()) as RawPost[]
  return posts.map((p) => {
    const media = p._embedded?.['wp:featuredmedia']?.[0]
    const sizes = media?.media_details?.sizes
    return {
      id: p.id,
      title: decode(p.title.rendered).trim(),
      image: sizes?.medium_large?.source_url ?? sizes?.large?.source_url ?? media?.source_url,
    }
  })
}

/** Posts newer than the last one already notified; newest first. */
export function newSince(latest: NewsItem[], lastId: number | null): NewsItem[] {
  if (lastId === null) return []
  const idx = latest.findIndex((p) => p.id === lastId)
  if (idx !== -1) return latest.slice(0, idx)
  // The last notified post dropped out of the newest 10 (or was unpublished): only higher ids count.
  return latest.filter((p) => p.id > lastId)
}

export interface Notice {
  title: string
  body: string
  url: string
  image?: string
  tag: string
}

export function buildNotices(fresh: NewsItem[]): Notice[] {
  if (fresh.length === 0) return []
  if (fresh.length <= MAX_SINGLE) {
    return fresh.map((p) => ({ title: 'R&M News', body: p.title, url: `#/article/${p.id}`, image: p.image, tag: `post-${p.id}` }))
  }
  return [{ title: `R&M News · ${fresh.length} new stories`, body: fresh[0].title, url: '#/news', image: fresh[0].image, tag: 'digest' }]
}

async function sendToAll(env: Env, notices: Notice[]): Promise<{ sent: number; removed: number }> {
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  let sent = 0
  let removed = 0
  let cursor: string | undefined
  do {
    const page = await env.SUBS.list({ prefix: SUB_PREFIX, cursor })
    cursor = page.list_complete ? undefined : page.cursor
    await Promise.all(
      page.keys.map(async ({ name }) => {
        const sub = await env.SUBS.get<PushSubscription>(name, 'json')
        if (!sub) return
        for (const n of notices) {
          try {
            const payload = await buildPushPayload({ data: { ...n }, options: { ttl: 6 * 60 * 60, urgency: 'normal', topic: n.tag.slice(0, 32) } }, sub, vapid)
            const res = await fetch(sub.endpoint, payload)
            if (res.status === 404 || res.status === 410) {
              // The device unsubscribed or the subscription expired.
              await env.SUBS.delete(name)
              removed++
              return
            }
            if (res.ok) sent++
          } catch {
            /* one bad device must not stop the rest */
          }
        }
      }),
    )
  } while (cursor)
  return { sent, removed }
}

export async function checkAndNotify(env: Env): Promise<string> {
  const latest = await fetchLatest(env)
  if (latest.length === 0) return 'no posts'
  const stored = await env.SUBS.get(LAST_KEY)
  const lastId = stored ? Number(stored) : null
  const fresh = newSince(latest, lastId)
  if (lastId === null || fresh.length > 0) await env.SUBS.put(LAST_KEY, String(latest[0].id))
  // First run only records the newest post, so nobody gets a burst of old stories.
  if (fresh.length === 0) return lastId === null ? `initialised at ${latest[0].id}` : 'nothing new'
  const result = await sendToAll(env, buildNotices(fresh))
  return `${fresh.length} new, ${result.sent} sent, ${result.removed} removed`
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin')
    const headers = cors(origin, env)
    const { pathname } = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method === 'GET' && pathname === '/vapid') return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, headers)
    if (req.method === 'GET' && pathname === '/') return json({ ok: true, service: 'R&M News push' }, 200, headers)
    if (req.method !== 'POST' || !headers['Access-Control-Allow-Origin']) return json({ error: 'not allowed' }, 403, headers)

    let body: unknown
    try {
      body = await readJson(req)
    } catch {
      return json({ error: 'bad request' }, 400, headers)
    }
    if (pathname === '/subscribe') {
      const sub = (body as { subscription?: unknown }).subscription
      if (!isValidSubscription(sub)) return json({ error: 'invalid subscription' }, 400, headers)
      const clean: PushSubscription = { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }
      await env.SUBS.put(await subKey(sub.endpoint), JSON.stringify(clean), { expirationTtl: 60 * 60 * 24 * 180 })
      return json({ ok: true }, 200, headers)
    }
    if (pathname === '/unsubscribe') {
      const endpoint = (body as { endpoint?: unknown }).endpoint
      if (typeof endpoint !== 'string') return json({ error: 'bad request' }, 400, headers)
      await env.SUBS.delete(await subKey(endpoint))
      return json({ ok: true }, 200, headers)
    }
    return json({ error: 'not found' }, 404, headers)
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(checkAndNotify(env).then((r) => console.log(r)))
  },
} satisfies ExportedHandler<Env>
