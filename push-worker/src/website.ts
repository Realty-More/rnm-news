// Website traffic and technical SEO for the Content Studio.
//   Views: realtynmore.com runs the "Post Views Counter" plugin, whose public REST route returns each
//   story's real view count. An hourly cron saves a snapshot per story, so we can show totals, the
//   last 24 hours and 7 days, the best sections and the best hours to publish.
//   SEO: the same page checks run on our stories and on rivals' latest stories, side by side.
import { decode } from './site.ts'
import { feedLinks } from './competitors.ts'
import type { Env } from './index.ts'

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RM-News-Studio/1.0)' }
const HOUR = 3600000
// Latest stories checked every hour, plus a rotating window of older ones.
// 2 list calls + 34 counts + up to 10 retries stays under the free plan's 50 requests per run.
const LATEST = 20
const OLDER = 14
const OLDER_SPAN = 280

const SECTION: Record<number, string> = {
  14: 'Interviews', 439: 'RERA', 40460: 'Leadership Updates', 11: 'Guest Column', 40322: 'Insights',
  196: 'Reports', 4: 'New Launches', 38: 'Developers Speak', 12: 'Events', 34: 'Top Stories', 1: 'News',
}
/** The story's most specific section ("News" only when nothing else fits). */
export function sectionOf(ids: number[]): string {
  const named = ids.map((id) => SECTION[id]).filter(Boolean)
  return named.find((n) => n !== 'News') ?? named[0] ?? 'Other'
}

interface ListedPost { id: number; date_gmt: string; link: string; title: { rendered: string }; categories: number[] }

async function listPosts(env: Env, count: number, offset: number): Promise<ListedPost[]> {
  const res = await fetch(`${env.SITE_API}/posts?per_page=${count}&offset=${offset}&_fields=id,date_gmt,link,title,categories`, { headers: UA })
  if (!res.ok) throw new Error(`site returned ${res.status}`)
  return res.json()
}

const viewsUrl = (env: Env, id: number) => `${env.SITE_API.replace(/\/wp\/v2\/?$/, '')}/post-views-counter/get-post-views/${id}`

/** One story's total views from the plugin, or null when it can't be read. */
async function viewsOf(env: Env, id: number): Promise<number | null> {
  try {
    const res = await fetch(viewsUrl(env, id), { headers: UA })
    if (!res.ok) return null
    const n = Number((await res.text()).trim().replace(/^"|"$/g, ''))
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

/**
 * Runs jobs 3 at a time and retries a failed one once: the site's shared hosting answers 500
 * when dozens of requests arrive together, and we must never slow the live website down.
 */
export async function gently<T>(jobs: (() => Promise<T | null>)[], width = 3, retries = 10): Promise<(T | null)[]> {
  const out: (T | null)[] = new Array(jobs.length).fill(null)
  let next = 0
  let left = retries
  const lane = async () => {
    while (next < jobs.length) {
      const i = next++
      out[i] = await jobs[i]()
      if (out[i] === null && left > 0) {
        left--
        await new Promise((r) => setTimeout(r, 400))
        out[i] = await jobs[i]()
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, lane))
  return out
}

/** Hourly: saves view counts for the latest stories and the next slice of older ones. */
export async function collectViews(env: Env): Promise<string> {
  const cursor = Number(await env.SUBS.get('web:cursor')) || 0
  const [latest, older] = await Promise.all([listPosts(env, LATEST, 0), listPosts(env, OLDER, LATEST + cursor).catch(() => [])])
  const next = older.length < OLDER || cursor + OLDER >= OLDER_SPAN ? 0 : cursor + OLDER
  await env.SUBS.put('web:cursor', String(next))
  const posts = [...latest, ...older]
  const counts = await gently(posts.map((p) => () => viewsOf(env, p.id)))
  const hour = new Date().toISOString().slice(0, 13)
  const now = new Date().toISOString()
  const stmts: D1PreparedStatement[] = []
  posts.forEach((p, i) => {
    const views = counts[i]
    if (views === null) return
    stmts.push(
      env.DB.prepare(
        `INSERT INTO webposts (post_id, title, link, published, section, views, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(post_id) DO UPDATE SET title = excluded.title, link = excluded.link, section = excluded.section, views = excluded.views, checked_at = excluded.checked_at`,
      ).bind(p.id, decode(p.title.rendered), p.link, `${p.date_gmt}Z`, sectionOf(p.categories), views, now),
      env.DB.prepare('INSERT OR REPLACE INTO webviews (post_id, hour, views) VALUES (?, ?, ?)').bind(p.id, hour, views),
    )
  })
  if (stmts.length) await env.DB.batch(stmts)
  await env.DB.prepare('DELETE FROM webviews WHERE hour < ?').bind(new Date(Date.now() - 45 * 24 * HOUR).toISOString().slice(0, 13)).run()
  return `${stmts.length / 2} of ${posts.length} stories`
}

export interface WebRow { id: number; title: string; link: string; section: string; published: string; views: number; gain24: number | null; gain7: number | null; app: number }

const IST = 5.5 * HOUR
const istHour = (iso: string) => new Date(Date.parse(iso) + IST).getUTCHours()
const istDay = (iso: string) => new Date(Date.parse(iso) + IST).getUTCDay()

/** Groups stories and averages their views; groups with fewer than `min` stories are left out. */
export function averageBy<K extends string | number>(rows: { views: number }[], key: (r: never) => K, min = 2): { key: K; stories: number; avg: number }[] {
  const groups = new Map<K, number[]>()
  for (const r of rows) {
    const k = key(r as never)
    groups.set(k, [...(groups.get(k) ?? []), r.views])
  }
  return [...groups]
    .filter(([, v]) => v.length >= min)
    .map(([k, v]) => ({ key: k, stories: v.length, avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }))
    .sort((a, b) => b.avg - a.avg)
}

/** Everything the Website tab shows. */
export async function webTraffic(env: Env) {
  const [{ results: posts }, firstSnap] = await Promise.all([
    env.DB.prepare('SELECT post_id AS id, title, link, section, published, views FROM webposts ORDER BY published DESC LIMIT 400').all<Omit<WebRow, 'gain24' | 'gain7' | 'app'>>(),
    env.DB.prepare('SELECT MIN(hour) AS h, MAX(hour) AS last FROM webviews').first<{ h: string | null; last: string | null }>(),
  ])
  const since = (h: number) => new Date(Date.now() - h * HOUR).toISOString().slice(0, 13)
  // Views only go up, so the smallest count inside a window is the count at its start.
  const [{ results: base24 }, { results: base7 }, { results: opens }] = await Promise.all([
    env.DB.prepare('SELECT post_id, MIN(views) AS v FROM webviews WHERE hour >= ? GROUP BY post_id').bind(since(24)).all<{ post_id: number; v: number }>(),
    env.DB.prepare('SELECT post_id, MIN(views) AS v FROM webviews WHERE hour >= ? GROUP BY post_id').bind(since(24 * 7)).all<{ post_id: number; v: number }>(),
    env.DB.prepare('SELECT post_id, SUM(n) AS n FROM opens GROUP BY post_id').all<{ post_id: number; n: number }>(),
  ])
  const b24 = new Map(base24.map((r) => [r.post_id, r.v]))
  const b7 = new Map(base7.map((r) => [r.post_id, r.v]))
  const app = new Map(opens.map((r) => [r.post_id, r.n]))
  const hoursTracked = firstSnap?.h ? Math.round((Date.now() - Date.parse(`${firstSnap.h}:00:00Z`)) / HOUR) : 0
  const rows: WebRow[] = posts.map((p) => ({
    ...p,
    gain24: b24.has(p.id) ? p.views - b24.get(p.id)! : null,
    gain7: b7.has(p.id) ? p.views - b7.get(p.id)! : null,
    app: app.get(p.id) ?? 0,
  }))
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const top = (by: (r: WebRow) => number) => [...rows].sort((a, b) => by(b) - by(a)).filter((r) => by(r) > 0).slice(0, 10)
  // Timing and sections: stories at least 2 days old and under 60 days, so young stories don't drag averages down.
  const settled = rows.filter((r) => {
    const age = Date.now() - Date.parse(r.published)
    return age >= 48 * HOUR && age <= 60 * 24 * HOUR
  })
  return {
    updatedAt: firstSnap?.last ? `${firstSnap.last}:00:00Z` : null,
    hoursTracked,
    totals: {
      stories: rows.length,
      views: sum(rows.map((r) => r.views)),
      gain24: hoursTracked >= 1 ? sum(rows.map((r) => r.gain24 ?? 0)) : null,
      gain7: hoursTracked >= 24 ? sum(rows.map((r) => r.gain7 ?? 0)) : null,
      avg: rows.length ? Math.round(sum(rows.map((r) => r.views)) / rows.length) : 0,
      appOpens: sum(rows.map((r) => r.app)),
    },
    top: { all: top((r) => r.views), day: top((r) => r.gain24 ?? 0), week: top((r) => r.gain7 ?? 0), app: top((r) => r.app) },
    sections: averageBy(settled, (r: WebRow) => r.section, 2),
    hours: averageBy(settled, (r: WebRow) => istHour(r.published), 2).sort((a, b) => a.key - b.key),
    days: averageBy(settled, (r: WebRow) => istDay(r.published), 2).sort((a, b) => a.key - b.key),
    settled: settled.length,
  }
}

/* ---------- Technical SEO, ours vs rivals ---------- */

export interface PageCheck { key: string; label: string; pass: boolean; fix: string }

const attr = (html: string, re: RegExp) => decode(re.exec(html)?.[1] ?? '').trim()

/** Page-level checks any news article should pass (the same rules for every site). */
export function pageChecks(html: string): PageCheck[] {
  const title = attr(html, /<title[^>]*>([^<]*)<\/title>/i)
  const desc = attr(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || attr(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)
  const robots = attr(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i)
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(' ')
  const h1 = (html.match(/<h1\b/gi) ?? []).length
  const c = (key: string, label: string, pass: boolean, fix: string): PageCheck => ({ key, label, pass, fix })
  return [
    c('title', 'SEO title 30–65 characters', title.length >= 30 && title.length <= 65, `Title is ${title.length} characters. Google cuts titles after about 60.`),
    c('desc', 'Meta description 70–160 characters', desc.length >= 70 && desc.length <= 160, desc ? `Description is ${desc.length} characters.` : 'Add a meta description (Rank Math ▸ Edit snippet).'),
    c('canonical', 'Canonical URL', /<link[^>]+rel=["']canonical["']/i.test(html), 'Add a canonical link so Google knows the main copy.'),
    c('og', 'Open Graph title and image', /property=["']og:title["']/i.test(html) && /property=["']og:image["']/i.test(html), 'Add og:title and og:image so WhatsApp, LinkedIn and Facebook show a preview.'),
    c('twitter', 'X (Twitter) card', /name=["']twitter:card["']/i.test(html), 'Add a twitter:card meta tag.'),
    c('schema', 'NewsArticle / Article schema', /"@type"\s*:\s*"(NewsArticle|Article|BlogPosting|ReportageNewsArticle)"/i.test(ld), 'Set Rank Math ▸ Schema to “News Article” for news posts (needed for Google News/Top stories).'),
    c('date', 'Published date in schema or meta', /datePublished|article:published_time/i.test(html), 'Expose datePublished so Google shows the story as fresh.'),
    c('h1', 'Exactly one H1 heading', h1 === 1, `Page has ${h1} H1 headings; keep one (the headline).`),
    c('index', 'Indexable (no "noindex")', !/noindex/i.test(robots), 'Remove noindex from this page.'),
    c('mobile', 'Mobile viewport tag', /<meta[^>]+name=["']viewport["']/i.test(html), 'Add a mobile viewport meta tag.'),
    c('lang', 'Page language set', /<html[^>]+lang=["'][a-z]{2}/i.test(html), 'Set lang="en" on the <html> tag.'),
    c('author', 'Author shown', /"author"\s*:|name=["']author["']|rel=["']author["']/i.test(html), 'Show an author (Google values clear authorship for news).'),
  ]
}

interface Sampled { title: string; link: string; score: number | null; ms: number | null; kb: number | null; checks: PageCheck[] }

async function sample(link: string, title: string): Promise<Sampled> {
  const t0 = Date.now()
  try {
    const res = await fetch(link, { headers: { ...UA, Accept: 'text/html' }, redirect: 'follow' })
    if (!res.ok) throw new Error(String(res.status))
    const html = await res.text()
    const ms = Date.now() - t0
    const checks = pageChecks(html.slice(0, 400000))
    return { title, link, ms, kb: Math.round(html.length / 1024), checks, score: Math.round((checks.filter((c) => c.pass).length / checks.length) * 100) }
  } catch {
    return { title, link, ms: null, kb: null, checks: [], score: null }
  }
}

/** Our latest stories and rivals' latest, through the same page checks. */
export async function seoCompare(env: Env) {
  const ours = (await listPosts(env, 3, 0)).map((p) => ({ title: decode(p.title.rendered), link: p.link }))
  const rivals = await feedLinks(2)
  const groups = [{ name: 'RealtyNMore', items: ours }, ...rivals]
  const sites = await Promise.all(
    groups.map(async (g) => {
      const pages = await Promise.all(g.items.map((i) => sample(i.link, i.title)))
      const ok = pages.filter((p) => p.score !== null)
      const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
      const rate = (key: string) => (ok.length ? ok.filter((p) => p.checks.find((c) => c.key === key)?.pass).length / ok.length : null)
      return {
        name: g.name,
        sampled: ok.length,
        blocked: ok.length === 0,
        score: avg(ok.map((p) => p.score!)),
        ms: avg(ok.map((p) => p.ms!)),
        kb: avg(ok.map((p) => p.kb!)),
        rates: Object.fromEntries((ok[0]?.checks ?? pageChecks('')).map((c) => [c.key, rate(c.key)])),
        pages: pages.map(({ title, link, score }) => ({ title, link, score })),
        ourChecks: g.name === 'RealtyNMore' ? ok[0]?.checks ?? [] : undefined,
      }
    }),
  )
  const labels = pageChecks('').map(({ key, label, fix }) => ({ key, label, fix }))
  const us = sites[0]
  // Checks rivals mostly pass and we mostly don't: the quickest wins.
  const gaps = labels.filter((l) => (us.rates[l.key] ?? 0) < 0.5 && sites.slice(1).some((s) => (s.rates[l.key] ?? 0) >= 0.5))
  return { generatedAt: new Date().toISOString(), checks: labels, sites, gaps }
}
