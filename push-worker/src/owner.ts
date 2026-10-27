// Owner & team tools for the Content Studio (all on the Cloudflare free plan):
// roles and editor keys, custom notifications, Editor's Pick, announcement banner, website uptime alerts,
// the 9 AM morning brief, the content calendar and per-story performance.
import { deliver, isValidSubscription, subKey, SUB_PREFIX, type Notice, type StoredSub } from './push.ts'
import { fetchByIds } from './site.ts'
import type { Env } from './index.ts'
import { sessionWho } from './accounts.ts'

/* ---------- roles: owner key (STATS_KEY) + revocable editor keys ---------- */
/** The owner key belongs to RealtyNMore's founder; records show this name. */
export const OWNER_NAME = 'Palash Roy'
export const OWNER_TITLE = 'Founder & Editor'

/**
 * owner: Palash Roy. admin: "full access" staff with every owner section, who can also give or
 * take away full access (but can't change the owner's account). editor: team member.
 */
export interface Who {
  role: 'owner' | 'admin' | 'editor'
  name: string
  id?: string
  /** Set when signed in with a mobile number and password. */
  phone?: string
}
interface Editor {
  id: string
  name: string
  created: string
  lastUsed?: string
  active: boolean
  /** Full access: sees and does everything the owner does. */
  admin?: boolean
}

/** Owner or full-access staff: allowed into the owner sections. */
export const full = (who: Who) => who.role === 'owner' || who.role === 'admin'

export async function sha256hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time compare. */
export function sameKey(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function authenticate(key: string, env: Env, ctx: ExecutionContext): Promise<Who | null> {
  if (sameKey(key, env.STATS_KEY ?? '')) return { role: 'owner', name: OWNER_NAME }
  if (key.startsWith('s_')) return sessionWho(env, key)
  if (key.length < 24 || key.length > 64) return null
  const id = await sha256hex(key)
  const ed = await env.SUBS.get<Editor>(`editor:${id}`, 'json')
  if (!ed?.active) return null
  // Note last use at most once an hour (KV writes are limited on the free plan).
  if (!ed.lastUsed || Date.now() - Date.parse(ed.lastUsed) > 3600000) ctx.waitUntil(env.SUBS.put(`editor:${id}`, JSON.stringify({ ...ed, lastUsed: new Date().toISOString() })))
  return { role: ed.admin ? 'admin' : 'editor', name: ed.name, id }
}

export async function listEditors(env: Env): Promise<Editor[]> {
  const page = await env.SUBS.list({ prefix: 'editor:' })
  const all = await Promise.all(page.keys.map((k) => env.SUBS.get<Editor>(k.name, 'json')))
  return all.filter((e): e is Editor => !!e).sort((a, b) => b.created.localeCompare(a.created))
}

export async function createEditor(env: Env, name: string): Promise<{ key: string; editor: Editor }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const id = await sha256hex(key)
  const editor: Editor = { id, name: name.trim().slice(0, 40) || 'Editor', created: new Date().toISOString(), active: true }
  await env.SUBS.put(`editor:${id}`, JSON.stringify(editor))
  return { key, editor }
}

/** Owner or full access: give or take away full access for a login key. */
export async function setKeyAccess(env: Env, id: string, admin: boolean) {
  if (!/^[0-9a-f]{64}$/.test(id)) return false
  const ed = await env.SUBS.get<Editor>(`editor:${id}`, 'json')
  if (!ed) return false
  await env.SUBS.put(`editor:${id}`, JSON.stringify({ ...ed, admin }))
  return true
}

export async function renameEditor(env: Env, id: string, name: string) {
  if (!/^[0-9a-f]{64}$/.test(id)) return
  const e = await env.SUBS.get<Editor>(`editor:${id}`, 'json')
  if (e) await env.SUBS.put(`editor:${id}`, JSON.stringify({ ...e, name }))
}

export async function revokeEditor(env: Env, id: string) {
  if (!/^[0-9a-f]{64}$/.test(id)) return false
  await env.SUBS.delete(`editor:${id}`)
  return true
}

/* ---------- owner devices (for uptime alerts and the morning brief) ---------- */
const OWNER_PREFIX = 'owner-sub:'

export async function registerOwnerDevice(env: Env, body: unknown, who: Who): Promise<boolean> {
  const sub = (body as { subscription?: unknown })?.subscription
  if (!isValidSubscription(sub)) return false
  const value: StoredSub = { sub: { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } }
  await env.SUBS.put(OWNER_PREFIX + (await subKey(sub.endpoint)).slice(SUB_PREFIX.length), JSON.stringify(value), { metadata: { by: who.name } })
  return true
}

export async function ownerDeviceCount(env: Env) {
  return (await env.SUBS.list({ prefix: OWNER_PREFIX })).keys.length
}

export const toOwners = (env: Env, notice: Notice) => deliver(env, OWNER_PREFIX, () => [notice])

/* ---------- #1 custom notification to all readers ---------- */
export const CUSTOM_PUSH_PER_DAY = 5

export function cleanNotice(body: unknown): Notice | string {
  const b = (body ?? {}) as { title?: unknown; body?: unknown; url?: unknown; image?: unknown }
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 60) : ''
  const text = typeof b.body === 'string' ? b.body.trim().slice(0, 180) : ''
  if (!text) return 'Write the message text.'
  let url = typeof b.url === 'string' ? b.url.trim() : ''
  // Accept a realtynmore.com story link, an app link (#/...) or nothing (opens Home).
  const story = /realtynmore\.com\/([^/?#]+)\/?/.exec(url)
  if (story) url = `#/read/${story[1]}`
  else if (!/^#\/[\w\-/?=&%.]*$/.test(url)) url = '#/'
  const image = typeof b.image === 'string' && /^https:\/\/realtynmore\.com\/wp-content\//.test(b.image) ? b.image : undefined
  return { title: title || 'Realtynmore', body: text, url, image, tag: `custom-${Date.now()}` }
}

const istDate = (ms = Date.now()) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10)

export async function customPush(env: Env, body: unknown, who: Who) {
  const notice = cleanNotice(body)
  if (typeof notice === 'string') return { ok: false, error: notice }
  const key = `state:custom-push:${istDate()}`
  const used = Number((await env.SUBS.get(key)) ?? 0)
  if (used >= CUSTOM_PUSH_PER_DAY) return { ok: false, error: `Daily limit reached (${CUSTOM_PUSH_PER_DAY} custom alerts a day keeps readers from muting the app).` }
  await env.SUBS.put(key, String(used + 1), { expirationTtl: 2 * 86400 })
  const result = await deliver(env, SUB_PREFIX, () => [notice])
  await env.DB.prepare('INSERT INTO pushes (ts, title, body, url, by_name, sent) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(new Date().toISOString(), notice.title, notice.body, notice.url, who.name, result.sent)
    .run()
  return { ok: true, sent: result.sent, removed: result.removed, left: CUSTOM_PUSH_PER_DAY - used - 1 }
}

export async function pushLog(env: Env) {
  const { results } = await env.DB.prepare('SELECT ts, title, body, url, by_name, sent FROM pushes ORDER BY ts DESC LIMIT 20').all()
  const left = CUSTOM_PUSH_PER_DAY - Number((await env.SUBS.get(`state:custom-push:${istDate()}`)) ?? 0)
  return { log: results, left }
}

/* ---------- #2 Editor's Pick and #3 announcement banner ---------- */
export interface SiteConfig {
  pin: { postId: number; until: string | null } | null
  banner: { id: string; text: string; link: string; until: string | null; tone: 'accent' | 'dark' } | null
}

const live = <T extends { until: string | null }>(x: T | null | undefined): T | null => (x && (!x.until || Date.parse(x.until) > Date.now()) ? x : null)

export async function siteConfig(env: Env): Promise<SiteConfig> {
  const raw = (await env.SUBS.get<SiteConfig>('site:config', 'json')) ?? { pin: null, banner: null }
  return { pin: live(raw.pin), banner: live(raw.banner) }
}

export function cleanSiteConfig(body: unknown, current: SiteConfig): SiteConfig | string {
  const b = (body ?? {}) as { pin?: unknown; banner?: unknown }
  const next: SiteConfig = { ...current }
  const until = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)
  if (b.pin === null) next.pin = null
  else if (b.pin && typeof b.pin === 'object') {
    const p = b.pin as { postId?: unknown; until?: unknown }
    const id = Number(p.postId)
    if (!Number.isInteger(id) || id <= 0) return 'Pick a story to pin.'
    next.pin = { postId: id, until: until(p.until) }
  }
  if (b.banner === null) next.banner = null
  else if (b.banner && typeof b.banner === 'object') {
    const x = b.banner as { text?: unknown; link?: unknown; until?: unknown; tone?: unknown }
    const text = typeof x.text === 'string' ? x.text.trim().slice(0, 140) : ''
    if (!text) return 'Write the banner text.'
    const link = typeof x.link === 'string' && (/^https:\/\//.test(x.link) || /^#\//.test(x.link)) ? x.link.trim().slice(0, 300) : ''
    next.banner = { id: `b${Date.now()}`, text, link, until: until(x.until), tone: x.tone === 'dark' ? 'dark' : 'accent' }
  }
  return next
}

export async function saveSiteConfig(env: Env, body: unknown) {
  const next = cleanSiteConfig(body, await siteConfig(env))
  if (typeof next === 'string') return { ok: false, error: next }
  await env.SUBS.put('site:config', JSON.stringify(next))
  return { ok: true, config: next }
}

/* ---------- #4 website uptime monitor ---------- */
interface MonState {
  down: boolean
  fails: number
  since: string | null
}

/** Pure state machine: alert after 2 failed checks in a row (20 min), and once when it recovers. */
export function nextMonState(prev: MonState, ok: boolean, now: string): { state: MonState; alert: 'down' | 'up' | null } {
  if (ok) {
    if (prev.down) return { state: { down: false, fails: 0, since: null }, alert: 'up' }
    return { state: { down: false, fails: 0, since: null }, alert: null }
  }
  const fails = prev.fails + 1
  if (!prev.down && fails >= 2) return { state: { down: true, fails, since: prev.since ?? now }, alert: 'down' }
  return { state: { down: prev.down, fails, since: prev.since ?? now }, alert: null }
}

export async function checkSite(env: Env): Promise<string> {
  const site = new URL(env.SITE_API).origin + '/'
  const t0 = Date.now()
  let ok = false
  let status = 0
  try {
    const res = await fetch(site, { headers: { 'User-Agent': 'RM-News-Uptime/1.0' }, signal: AbortSignal.timeout(15000) })
    status = res.status
    ok = res.ok
  } catch {
    status = 0
  }
  const ms = Date.now() - t0
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO uptime (ts, ok, ms, status) VALUES (?1, ?2, ?3, ?4)').bind(now, ok ? 1 : 0, ms, status).run()
  const prev = (await env.SUBS.get<MonState>('state:monitor', 'json')) ?? { down: false, fails: 0, since: null }
  const { state, alert } = nextMonState(prev, ok, now)
  if (JSON.stringify(state) !== JSON.stringify(prev)) await env.SUBS.put('state:monitor', JSON.stringify(state))
  if (alert === 'down') await toOwners(env, { title: '⚠️ realtynmore.com is down', body: `No response from the website (${status || 'timeout'}) in the last 2 checks.`, url: '#/studio?tab=site', tag: 'uptime' })
  if (alert === 'up') {
    const mins = prev.since ? Math.round((Date.now() - Date.parse(prev.since)) / 60000) : 0
    await toOwners(env, { title: '✅ realtynmore.com is back up', body: `The website is responding again after about ${mins} minutes.`, url: '#/studio?tab=site', tag: 'uptime' })
  }
  return `site ${ok ? 'up' : 'DOWN'} ${status} ${ms}ms`
}

export async function uptimeSummary(env: Env) {
  const days = await env.DB.prepare(
    "SELECT substr(ts,1,10) AS day, COUNT(*) AS checks, SUM(ok) AS up, CAST(AVG(ms) AS INTEGER) AS avg_ms FROM uptime WHERE ts >= datetime('now','-7 day') GROUP BY day ORDER BY day DESC",
  ).all<{ day: string; checks: number; up: number; avg_ms: number }>()
  const incidents = await env.DB.prepare("SELECT ts, status, ms FROM uptime WHERE ok = 0 AND ts >= datetime('now','-7 day') ORDER BY ts DESC LIMIT 20").all()
  const state = (await env.SUBS.get<MonState>('state:monitor', 'json')) ?? { down: false, fails: 0, since: null }
  const checks = days.results.reduce((a, d) => a + d.checks, 0)
  const up = days.results.reduce((a, d) => a + d.up, 0)
  return { now: state, uptime7: checks ? Math.round((up / checks) * 1000) / 10 : null, days: days.results, incidents: incidents.results, ownerDevices: await ownerDeviceCount(env) }
}

/* ---------- #5 morning brief (9 AM IST) ---------- */
export function briefText(d: { views: number; opens: number; top: string | null; uptime: number | null; gap: string | null; team?: string | null; ads?: string | null }): string {
  const parts = [`Yesterday: ${d.views} screen views, ${d.opens} stories read.`]
  if (d.top) parts.push(`Top: ${d.top}.`)
  if (d.uptime !== null) parts.push(`Website uptime ${d.uptime}%.`)
  if (d.gap) parts.push(`Readers searched “${d.gap}” and found nothing.`)
  if (d.team) parts.push(d.team)
  if (d.ads) parts.push(d.ads)
  return parts.join(' ').slice(0, 300)
}

export async function morningBrief(env: Env, force = false): Promise<string> {
  const now = Date.now()
  const ist = new Date(now + 5.5 * 3600000)
  const due = ist.getUTCHours() === 9 && ist.getUTCMinutes() < 10
  const key = `state:brief:${istDate(now)}`
  if (!force && (!due || (await env.SUBS.get(key)))) return 'brief not due'
  await env.SUBS.put(key, '1', { expirationTtl: 2 * 86400 })
  const y = istDate(now - 86400000)
  const one = async <T,>(sql: string) => (await env.DB.prepare(sql).bind(y).first<T>()) ?? null
  const views = (await one<{ n: number }>('SELECT COALESCE(SUM(n),0) AS n FROM pages WHERE day = ?1'))?.n ?? 0
  const opens = (await one<{ n: number }>('SELECT COALESCE(SUM(n),0) AS n FROM opens WHERE day = ?1'))?.n ?? 0
  const topRow = await one<{ id: number }>('SELECT post_id AS id FROM opens WHERE day = ?1 ORDER BY n DESC LIMIT 1')
  const gapRow = await one<{ q: string }>('SELECT q FROM searches WHERE day = ?1 AND zero > 0 ORDER BY zero DESC LIMIT 1')
  const up = await one<{ c: number; u: number }>('SELECT COUNT(*) AS c, SUM(ok) AS u FROM uptime WHERE substr(ts,1,10) = ?1')
  const top = topRow ? (await fetchByIds(env.SITE_API, [topRow.id]).catch(() => []))[0]?.title ?? null : null
  const { teamBriefLine } = await import('./team.ts')
  const team = await teamBriefLine(env).catch(() => null)
  const { adsBrief } = await import('./ads.ts')
  const ads = await adsBrief(env).catch(() => null)
  const body = briefText({ views, opens, top, uptime: up?.c ? Math.round((up.u / up.c) * 1000) / 10 : null, gap: gapRow?.q ?? null, team, ads })
  const r = await toOwners(env, { title: '☀️ R&M morning brief', body, url: '#/studio', tag: 'brief' })
  return `brief sent to ${r.sent}`
}

/* ---------- #6 per-story performance ---------- */
export async function performance(env: Env, days: number) {
  const since = istDate(Date.now() - (days - 1) * 86400000)
  const opens = await env.DB.prepare('SELECT post_id AS id, SUM(n) AS n FROM opens WHERE day >= ?1 GROUP BY post_id').bind(since).all<{ id: number; n: number }>()
  const shares = await env.DB.prepare('SELECT post_id AS id, channel, SUM(n) AS n FROM shares WHERE day >= ?1 GROUP BY post_id, channel').bind(since).all<{ id: number; channel: string; n: number }>()
  const rows = new Map<number, { id: number; opens: number; share: number; whatsapp: number; copy: number }>()
  const row = (id: number) => rows.get(id) ?? rows.set(id, { id, opens: 0, share: 0, whatsapp: 0, copy: 0 }).get(id)!
  for (const o of opens.results) row(o.id).opens += o.n
  for (const s of shares.results) {
    const r = row(s.id)
    if (s.channel === 'whatsapp') r.whatsapp += s.n
    else if (s.channel === 'copy') r.copy += s.n
    else r.share += s.n
  }
  const top = [...rows.values()].sort((a, b) => b.opens + 3 * (b.share + b.whatsapp) - (a.opens + 3 * (a.share + a.whatsapp))).slice(0, 30)
  const posts = await fetchByIds(env.SITE_API, top.map((t) => t.id)).catch(() => [])
  const byId = new Map(posts.map((p) => [p.id, p]))
  return { days, stories: top.map((t) => ({ ...t, title: byId.get(t.id)?.title ?? `Story ${t.id}`, link: byId.get(t.id)?.link ?? null })) }
}

/* ---------- #8 content calendar ---------- */
const STATUSES = ['idea', 'writing', 'published'] as const
type Status = (typeof STATUSES)[number]

export async function listIdeas(env: Env) {
  const { results } = await env.DB.prepare('SELECT id, title, notes, status, due, source, created_by, created_at, updated_at FROM calendar ORDER BY CASE status WHEN \'writing\' THEN 0 WHEN \'idea\' THEN 1 ELSE 2 END, COALESCE(due, \'9999\'), id DESC LIMIT 200').all()
  return { items: results }
}

export function cleanIdea(body: unknown): { title: string; notes: string; status: Status; due: string | null; source: string } | string {
  const b = (body ?? {}) as Record<string, unknown>
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 160) : ''
  if (!title) return 'Write a title.'
  const status = STATUSES.includes(b.status as Status) ? (b.status as Status) : 'idea'
  const due = typeof b.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : null
  return { title, notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, 1000) : '', status, due, source: typeof b.source === 'string' ? b.source.slice(0, 300) : '' }
}

export async function saveIdea(env: Env, body: unknown, who: Who) {
  const idea = cleanIdea(body)
  if (typeof idea === 'string') return { ok: false, error: idea }
  const id = Number((body as { id?: unknown })?.id)
  const now = new Date().toISOString()
  if (Number.isInteger(id) && id > 0) {
    await env.DB.prepare('UPDATE calendar SET title=?1, notes=?2, status=?3, due=?4, source=?5, updated_at=?6 WHERE id=?7').bind(idea.title, idea.notes, idea.status, idea.due, idea.source, now, id).run()
    return { ok: true, id }
  }
  const r = await env.DB.prepare('INSERT INTO calendar (title, notes, status, due, source, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)')
    .bind(idea.title, idea.notes, idea.status, idea.due, idea.source, who.name, now)
    .run()
  return { ok: true, id: r.meta.last_row_id }
}

export async function deleteIdea(env: Env, id: number) {
  if (!Number.isInteger(id) || id <= 0) return false
  await env.DB.prepare('DELETE FROM calendar WHERE id = ?1').bind(id).run()
  return true
}
