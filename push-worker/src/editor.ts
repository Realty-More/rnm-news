// Owner-only "Content Studio" data (needs the owner key). Every number comes from a real source:
// app usage (D1), realtynmore.com (WordPress API + public pages), Google search suggestions,
// Google Trends India (daily RSS) and public RSS feeds of other real-estate news sites.
import { XMLParser } from 'fast-xml-parser'
import { decode, fetchByIds } from './site.ts'
import { subscriberCount } from './push.ts'
import type { Env } from './index.ts'

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RM-News-Studio/1.0)' }
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' })
const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])
const text = (v: unknown): string => (typeof v === 'object' && v !== null && '#text' in v ? String((v as Record<string, unknown>)['#text']) : v == null ? '' : String(v))
const strip = (html: string) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

/* ---------- 1. Overview: what readers do in the app ---------- */
export async function overview(env: Env) {
  const one = async <T,>(sql: string) => (await env.DB.prepare(sql).all<T>()).results
  const [views, opens, top, searches, zero] = await Promise.all([
    one<{ n: number }>("SELECT COALESCE(SUM(n),0) AS n FROM pages WHERE day >= date('now','-6 day')"),
    one<{ n: number }>("SELECT COALESCE(SUM(n),0) AS n FROM opens WHERE day >= date('now','-6 day')"),
    one<{ id: number; opens: number }>("SELECT post_id AS id, SUM(n) AS opens FROM opens WHERE day >= date('now','-6 day') GROUP BY post_id ORDER BY opens DESC LIMIT 10"),
    one<{ q: string; n: number }>("SELECT q, SUM(n) AS n FROM searches WHERE day >= date('now','-29 day') GROUP BY q ORDER BY n DESC LIMIT 20"),
    one<{ q: string; n: number }>("SELECT q, SUM(zero) AS n FROM searches WHERE day >= date('now','-29 day') GROUP BY q HAVING SUM(zero) > 0 ORDER BY n DESC LIMIT 20"),
  ])
  const posts = await fetchByIds(env.SITE_API, top.map((t) => t.id)).catch(() => [])
  const byId = new Map(posts.map((p) => [p.id, p]))
  return {
    subscribers: await subscriberCount(env),
    views7: views[0]?.n ?? 0,
    opens7: opens[0]?.n ?? 0,
    topArticles: top.map((t) => ({ id: t.id, opens: t.opens, title: byId.get(t.id)?.title ?? `Post ${t.id}`, link: byId.get(t.id)?.link })),
    searches,
    zeroSearches: zero,
  }
}

/* ---------- 2. Content ideas ---------- */
const STOP = new Set('the and for with from that this into over amid after says said will have has are its new more than india indian crore lakh year years report percent per cent today about their which what when where how why who could would should also been being were your just only into upto while under'.split(' '))
export function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  )
}
/** True if one of our recent headlines shares enough important words with theirs. */
export function covered(theirs: string, ours: Set<string>[]): boolean {
  const t = tokens(theirs)
  if (t.size === 0) return true
  return ours.some((o) => {
    let shared = 0
    for (const w of t) if (o.has(w)) shared++
    return shared >= 3 || shared / t.size >= 0.5
  })
}

const RIVALS = [
  { name: 'ET Realty', url: 'https://realty.economictimes.indiatimes.com/rss/topstories' },
  { name: 'Hindustan Times', url: 'https://www.hindustantimes.com/feeds/rss/real-estate/rssfeed.xml' },
]

export const RE_WORDS = ['real estate', 'realty', 'property', 'properties', 'housing', 'home loan', 'flat', 'apartment', 'rera', 'land', 'rent', 'emi', 'repo rate', 'rbi', 'builder', 'developer', 'metro', 'airport', 'expressway', 'stamp duty', 'smart city', 'dlf', 'godrej', 'lodha', 'sobha', 'prestige', 'oberoi', 'brigade', 'noida', 'gurugram', 'gurgaon', 'mumbai', 'pune', 'bengaluru', 'hyderabad', 'jewar', 'infrastructure']

/** Whole-word match, so "land" doesn't match "England" or "rent" match "current". */
export const isRealEstate = (hay: string) => RE_WORDS.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(hay))

async function rivalHeadlines() {
  const out: { source: string; title: string; link: string; date: string }[] = []
  await Promise.all(
    RIVALS.map(async (r) => {
      try {
        const res = await fetch(r.url, { headers: UA })
        if (!res.ok) return
        const doc = xml.parse(await res.text())
        const items = asArray(doc?.rss?.channel?.item ?? doc?.feed?.entry)
        for (const it of items.slice(0, 20)) {
          const link = typeof it.link === 'object' ? text(it.link?.['@href'] ?? it.link) : text(it.link)
          out.push({ source: r.name, title: strip(text(it.title)), link, date: text(it.pubDate ?? it.updated ?? it.published) })
        }
      } catch {
        /* one feed down must not break the page */
      }
    }),
  )
  return out
}

async function googleTrendsIndia() {
  try {
    const res = await fetch('https://trends.google.com/trending/rss?geo=IN', { headers: UA })
    if (!res.ok) return []
    const items = asArray(xml.parse(await res.text())?.rss?.channel?.item)
    return items.map((it) => {
      const title = text(it.title)
      const news = asArray(it['ht:news_item']).map((n) => strip(text(n['ht:news_item_title'])))
      const hay = `${title} ${news.join(' ')}`.toLowerCase()
      return { title, traffic: text(it['ht:approx_traffic']), news: news.slice(0, 2), realEstate: isRealEstate(hay) }
    })
  } catch {
    return []
  }
}

interface WpCat {
  id: number
  name: string
}
async function sectionFreshness(env: Env) {
  const SECTIONS: WpCat[] = [
    { id: 14, name: 'Interviews' },
    { id: 439, name: 'RERA' },
    { id: 40460, name: 'Leadership Updates' },
    { id: 11, name: 'Guest Column' },
    { id: 40322, name: 'Insights' },
    { id: 196, name: 'Reports' },
    { id: 4, name: 'New Launches' },
    { id: 38, name: 'Developers Speak' },
    { id: 12, name: 'Events' },
  ]
  return Promise.all(
    SECTIONS.map(async (s) => {
      const res = await fetch(`${env.SITE_API}/posts?categories=${s.id}&per_page=1&_fields=date_gmt`, { headers: UA }).catch(() => null)
      const rows = res?.ok ? ((await res.json()) as { date_gmt: string }[]) : []
      const last = rows[0]?.date_gmt ? `${rows[0].date_gmt}Z` : null
      const days = last ? Math.floor((Date.now() - Date.parse(last)) / 86400000) : null
      return { section: s.name, lastPost: last, daysAgo: days }
    }),
  )
}

export async function ideas(env: Env) {
  const [rivals, trends, fresh, oursRes, zero] = await Promise.all([
    rivalHeadlines(),
    googleTrendsIndia(),
    sectionFreshness(env),
    fetch(`${env.SITE_API}/posts?per_page=100&_fields=title`, { headers: UA }).then((r) => (r.ok ? (r.json() as Promise<{ title: { rendered: string } }[]>) : [])),
    env.DB.prepare("SELECT q, SUM(zero) AS n FROM searches WHERE day >= date('now','-29 day') GROUP BY q HAVING SUM(zero) > 0 ORDER BY n DESC LIMIT 10").all<{ q: string; n: number }>(),
  ])
  const ours = oursRes.map((p) => tokens(decode(p.title.rendered)))
  return {
    notCovered: rivals.filter((r) => !covered(r.title, ours)).slice(0, 25),
    trends,
    sections: fresh.sort((a, b) => (b.daysAgo ?? 9999) - (a.daysAgo ?? 9999)),
    readerGaps: zero.results,
  }
}

/* ---------- 3. Keywords: Google search suggestions ---------- */
export const SEEDS = [
  'real estate',
  'property in',
  'flats in gurugram',
  'flats in noida',
  'property in mumbai',
  'rera',
  'home loan',
  'commercial property',
  'luxury apartments',
  'affordable housing',
  'plots in',
  'new launch projects',
]

export async function keywords(seeds: string[]) {
  const results = await Promise.all(
    seeds.slice(0, 15).map(async (seed) => {
      try {
        const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=in&q=${encodeURIComponent(seed)}`, { headers: UA })
        const data = (await res.json()) as [string, string[]]
        return { seed, suggestions: (data[1] ?? []).filter((s) => s !== seed).slice(0, 10) }
      } catch {
        return { seed, suggestions: [] as string[] }
      }
    }),
  )
  return { results }
}

/* ---------- 4. SEO check of the latest posts ---------- */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export interface SeoInput {
  title: string
  slug: string
  content: string
  hasImage: boolean
  seoTitle: string | null
  metaDescription: string | null
  categories: number[]
  tags: number[]
}

/** Plain, checkable rules; each issue says what to fix. */
export function seoIssues(p: SeoInput): string[] {
  const issues: string[] = []
  const full = slugify(p.title)
  if (full.startsWith(p.slug) && full.length > p.slug.length + 3 && !full.slice(p.slug.length).startsWith('-')) issues.push('URL is cut off in the middle of a word; use a short, complete slug')
  const seoTitle = p.seoTitle ?? p.title
  if (seoTitle.length > 65) issues.push(`SEO title is ${seoTitle.length} characters; keep it under 60–65`)
  if (!p.metaDescription) issues.push('No meta description')
  else if (p.metaDescription.length < 70) issues.push('Meta description is too short (under 70 characters)')
  else if (/(\.\.\.|…|&amp;|&)$/.test(p.metaDescription.trim()) || p.metaDescription.length >= 158) issues.push('Meta description looks auto-cut; write a 140–155 character summary')
  if (!p.hasImage) issues.push('No featured image')
  const imgs = p.content.match(/<img\b[^>]*>/g) ?? []
  const noAlt = imgs.filter((i) => !/\balt="[^"]+"/.test(i)).length
  if (noAlt) issues.push(`${noAlt} image(s) without alt text`)
  const words = strip(p.content).split(' ').filter(Boolean).length
  if (words < 300) issues.push(`Only ${words} words; aim for 400+ for news, 800+ for explainers`)
  if (!/<h2\b/i.test(p.content) && words > 600) issues.push('Long article without H2 subheadings')
  const internal = (p.content.match(/href="https?:\/\/(www\.)?realtynmore\.com\/[^"]+"/g) ?? []).length
  if (internal === 0) issues.push('No internal links to other RealtyNMore stories')
  if (p.tags.length === 0) issues.push('No tags')
  if (p.categories.length === 1 && p.categories[0] === 1) issues.push('Only in the general “News” category; add a specific section')
  return issues
}

function meta(html: string, re: RegExp): string | null {
  const m = re.exec(html)
  return m ? decode(m[1]).trim() : null
}

export async function seoAudit(env: Env) {
  const res = await fetch(`${env.SITE_API}/posts?per_page=15&_fields=id,slug,link,title,content,featured_media,categories,tags`, { headers: UA })
  if (!res.ok) throw new Error(`site returned ${res.status}`)
  const posts = (await res.json()) as { id: number; slug: string; link: string; title: { rendered: string }; content: { rendered: string }; featured_media: number; categories: number[]; tags: number[] }[]
  const audited = await Promise.all(
    posts.map(async (p) => {
      let html = ''
      try {
        const page = await fetch(p.link, { headers: UA })
        html = page.ok ? (await page.text()).slice(0, 60000) : ''
      } catch {
        /* keep going without page meta */
      }
      const title = decode(p.title.rendered)
      const issues = seoIssues({
        title,
        slug: p.slug,
        content: p.content.rendered,
        hasImage: p.featured_media > 0,
        seoTitle: meta(html, /<title>([^<]*)<\/title>/i),
        metaDescription: meta(html, /<meta name="description" content="([^"]*)"/i),
        categories: p.categories,
        tags: p.tags,
      })
      return { id: p.id, title, link: p.link, issues, score: Math.max(0, 100 - issues.length * 12) }
    }),
  )
  const avg = Math.round(audited.reduce((a, p) => a + p.score, 0) / Math.max(1, audited.length))
  return { average: avg, posts: audited.sort((a, b) => a.score - b.score) }
}
