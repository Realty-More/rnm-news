// Breaking-news alerts: subscriptions (KV) and the 10-minute check for new posts.
import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push'
import { fetchLatest, type NewsItem } from './site.ts'
import type { Env } from './index.ts'

const LAST_KEY = 'state:last-post'
export const SUB_PREFIX = 'sub:'
const MAX_SINGLE = 3 // more new posts than this become one summary notification

/** What a device wants: everything, or only its chosen sections (category ids) and cities. */
export interface Filters {
  topics: number[]
  cities: string[]
}

export interface StoredSub {
  sub: PushSubscription
  filters?: Filters
}

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

export function cleanFilters(f: unknown): Filters | undefined {
  if (!f || typeof f !== 'object') return undefined
  const { topics, cities } = f as Partial<Filters>
  const t = Array.isArray(topics) ? topics.filter((n) => Number.isInteger(n) && n > 0).slice(0, 30) : []
  const c = Array.isArray(cities) ? cities.filter((s) => typeof s === 'string' && s.length <= 40).slice(0, 30) : []
  return t.length || c.length ? { topics: t, cities: c } : undefined
}

export async function subKey(endpoint: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return SUB_PREFIX + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Posts newer than the last one already notified; newest first. */
export function newSince(latest: NewsItem[], lastId: number | null): NewsItem[] {
  if (lastId === null) return []
  const idx = latest.findIndex((p) => p.id === lastId)
  if (idx !== -1) return latest.slice(0, idx)
  // The last notified post dropped out of the newest 10 (or was unpublished): only higher ids count.
  return latest.filter((p) => p.id > lastId)
}

/** Keeps the posts that match a device's chosen sections or cities (no filters = everything). */
export function matching(posts: NewsItem[], filters?: Filters): NewsItem[] {
  if (!filters) return posts
  const cities = filters.cities.map((c) => c.toLowerCase())
  return posts.filter((p) => {
    if (p.categories.some((c) => filters.topics.includes(c))) return true
    const text = `${p.title} ${p.excerpt}`.toLowerCase()
    return cities.some((c) => text.includes(c))
  })
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

/** Sends to every stored subscription under `prefix`; `noticesFor` decides what each device gets. */
export async function deliver(env: Env, prefix: string, noticesFor: (s: StoredSub) => Notice[]): Promise<{ sent: number; removed: number }> {
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  let sent = 0
  let removed = 0
  let cursor: string | undefined
  do {
    const page = await env.SUBS.list({ prefix, cursor })
    cursor = page.list_complete ? undefined : page.cursor
    await Promise.all(
      page.keys.map(async ({ name }) => {
        const raw = await env.SUBS.get<StoredSub | PushSubscription>(name, 'json')
        if (!raw) return
        // Older entries stored the bare subscription.
        const stored: StoredSub = 'sub' in raw ? raw : { sub: raw }
        for (const n of noticesFor(stored)) {
          try {
            const payload = await buildPushPayload({ data: { ...n }, options: { ttl: 6 * 60 * 60, urgency: 'normal', topic: n.tag.slice(0, 32) } }, stored.sub, vapid)
            const res = await fetch(stored.sub.endpoint, payload)
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

const sendToAll = (env: Env, fresh: NewsItem[]) => deliver(env, SUB_PREFIX, (s) => buildNotices(matching(fresh, s.filters)))

export async function checkAndNotify(env: Env): Promise<string> {
  const latest = await fetchLatest(env.SITE_API)
  if (latest.length === 0) return 'no posts'
  const stored = await env.SUBS.get(LAST_KEY)
  const lastId = stored ? Number(stored) : null
  const fresh = newSince(latest, lastId)
  if (lastId === null || fresh.length > 0) await env.SUBS.put(LAST_KEY, String(latest[0].id))
  // First run only records the newest post, so nobody gets a burst of old stories.
  if (fresh.length === 0) return lastId === null ? `initialised at ${latest[0].id}` : 'nothing new'
  const result = await sendToAll(env, fresh)
  return `${fresh.length} new, ${result.sent} sent, ${result.removed} removed`
}

export async function subscribe(env: Env, body: unknown): Promise<boolean> {
  const { subscription, filters } = (body ?? {}) as { subscription?: unknown; filters?: unknown }
  if (!isValidSubscription(subscription)) return false
  const value: StoredSub = {
    sub: { endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
    filters: cleanFilters(filters),
  }
  await env.SUBS.put(await subKey(subscription.endpoint), JSON.stringify(value), { expirationTtl: 60 * 60 * 24 * 180 })
  return true
}

export async function subscriberCount(env: Env): Promise<number> {
  let n = 0
  let cursor: string | undefined
  do {
    const page = await env.SUBS.list({ prefix: SUB_PREFIX, cursor })
    n += page.keys.length
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return n
}
