// Competitor comparison for the owner's Content Studio. Only public data that the sites publish for
// readers and search engines (RSS feeds, news sitemaps, open WordPress APIs); nothing behind bot checks.
import { XMLParser } from 'fast-xml-parser'
import { decode } from './site.ts'
import type { Env } from './index.ts'

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RM-News-Studio/1.0)' }
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' })
const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])
const text = (v: unknown): string => (typeof v === 'object' && v !== null && '#text' in v ? String((v as Record<string, unknown>)['#text']) : v == null ? '' : String(v))
const DAY = 86400000

export interface Item {
  title: string
  date: string // ISO
  link: string
  /** Topic keys known from the site's own categories (RealtyNMore only). */
  tags?: string[]
}

export interface Source {
  name: string
  items: Item[]
  /** Exact counts when the site has an open API; otherwise estimated from the latest items. */
  posts7?: number
  posts30?: number
  basis: string
}

/* ---------- fetching ---------- */
async function rss(urls: string[]): Promise<Item[]> {
  const all: Item[] = []
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: UA })
      if (!res.ok) continue
      const doc = xml.parse(await res.text())
      for (const it of asArray(doc?.rss?.channel?.item ?? doc?.feed?.entry)) {
        const link = typeof it.link === 'object' ? text(it.link?.['@href'] ?? it.link) : text(it.link)
        const date = new Date(text(it.pubDate ?? it.updated ?? it.published))
        if (Number.isNaN(date.getTime())) continue
        all.push({ title: decode(text(it.title)).replace(/\s+/g, ' ').trim(), date: date.toISOString(), link })
      }
    } catch {
      /* skip a broken feed */
    }
  }
  const seen = new Set<string>()
  return all.filter((i) => (seen.has(i.link) ? false : (seen.add(i.link), true))).sort((a, b) => b.date.localeCompare(a.date))
}

async function newsSitemap(url: string): Promise<Item[]> {
  try {
    const res = await fetch(url, { headers: UA })
    if (!res.ok) return []
    const doc = xml.parse(await res.text())
    return asArray(doc?.urlset?.url)
      .map((u) => ({ title: decode(text(u['news:news']?.['news:title'])).trim(), date: new Date(text(u['news:news']?.['news:publication_date'])).toISOString(), link: text(u.loc) }))
      .filter((i) => i.title)
      .sort((a, b) => b.date.localeCompare(a.date))
  } catch {
    return []
  }
}

// RealtyNMore category id -> topic key (more reliable than headline words for our own stories).
const OUR_CATEGORY_TOPICS: Record<number, string> = { 14: 'people', 11: 'people', 38: 'people', 439: 'policy', 4: 'launch', 196: 'data', 40460: 'appoint', 40322: 'explainer' }

async function wordpress(api: string): Promise<{ items: Item[]; posts7: number; posts30: number } | null> {
  const iso = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 19)
  try {
    const list = await fetch(`${api}/posts?per_page=100&after=${iso(30 * DAY)}&_fields=title,date_gmt,link,categories`, { headers: UA })
    if (!list.ok) return null
    const rows = (await list.json()) as { title: { rendered: string }; date_gmt: string; link: string; categories?: number[] }[]
    const posts30 = Number(list.headers.get('X-WP-Total') ?? rows.length)
    const week = await fetch(`${api}/posts?per_page=1&after=${iso(7 * DAY)}&_fields=id`, { headers: UA })
    const posts7 = Number(week.headers.get('X-WP-Total') ?? 0)
    return {
      items: rows.map((r) => ({
        title: decode(r.title.rendered).trim(),
        date: `${r.date_gmt}Z`,
        link: r.link,
        tags: (r.categories ?? []).map((c) => OUR_CATEGORY_TOPICS[c]).filter(Boolean),
      })),
      posts7,
      posts30,
    }
  } catch {
    return null
  }
}

/** Each rival's latest `n` story links (for the side-by-side SEO check). */
export async function feedLinks(n: number): Promise<{ name: string; items: { title: string; link: string }[] }[]> {
  const pick = (items: Item[]) => items.slice(0, n).map(({ title, link }) => ({ title, link }))
  const [et, ht, nxt, sy] = await Promise.all([
    rss(['https://realty.economictimes.indiatimes.com/rss/topstories']),
    rss(['https://www.hindustantimes.com/feeds/rss/real-estate/rssfeed.xml']),
    newsSitemap('https://www.realtynxt.com/news-sitemap.xml'),
    fetch('https://www.squareyards.com/blog/wp-json/wp/v2/posts?per_page=3&_fields=title,link', { headers: UA })
      .then((r) => (r.ok ? (r.json() as Promise<{ title: { rendered: string }; link: string }[]>) : []))
      .then((rows) => rows.map((r) => ({ title: decode(r.title.rendered), date: '', link: r.link })))
      .catch(() => [] as Item[]),
  ])
  return [
    { name: 'ET Realty', items: pick(et) },
    { name: 'Hindustan Times Real Estate', items: pick(ht) },
    { name: 'RealtyNXT', items: pick(nxt) },
    { name: 'Square Yards', items: pick(sy) },
  ]
}

/* ---------- analysis (pure, tested) ---------- */
export const TOPICS: { key: string; label: string; words: RegExp }[] = [
  { key: 'policy', label: 'Policy, RERA & courts', words: /\b(rera|policy|govt|government|ministry|minister|court|hc|tribunal|nclt|regulat\w*|stamp duty|gst|budget|cabinet|notif\w*|rules?)\b/i },
  { key: 'launch', label: 'Launches & projects', words: /\b(launch\w*|unveil\w*|project|projects|tower|phase|sold out|bookings?|township|villas?)\b/i },
  { key: 'deals', label: 'Deals, leasing & land', words: /\b(lease[sd]?|leasing|acquir\w*|acquisition|deal|land parcel|acres?|sq ?ft|stake|jv|joint venture|tie[- ]up|partners?hip)\b/i },
  { key: 'finance', label: 'Results, funds & markets', words: /\b(q[1-4]|quarter\w*|profit|revenue|pre-?sales|sales booking|ipo|shares?|stocks?|reits?|fund\w*|raises?|invest\w*|crore|loan|rbi|repo)\b/i },
  { key: 'infra', label: 'Infrastructure & cities', words: /\b(metro|airport|expressway|highway|flyover|infra\w*|smart city|corridor|railway|bridge|road)\b/i },
  { key: 'explainer', label: 'Explainers & buyer guides', words: /\b(how|what|why|guide|tips|explained|should you|things to|ways to|checklist|vs\.?|benefits|meaning)\b/i },
  { key: 'people', label: 'Interviews & opinion', words: /\b(interview|in conversation|opinion|column|says|ceo|md|founder|chairman|exclusive|podcast)\b/i },
  { key: 'appoint', label: 'Appointments', words: /\b(appoint\w*|joins|elevat\w*|names .* as|takes charge|steps down)\b/i },
  { key: 'data', label: 'Reports & data', words: /\b(report|data|survey|index|study|research|prices? (rise|fall|up|down)|\d+(\.\d+)?\s?(%|per ?cent))\b/i },
]

export const CITIES = ['Mumbai', 'Navi Mumbai', 'Thane', 'Pune', 'Delhi', 'Gurugram', 'Noida', 'Greater Noida', 'Ghaziabad', 'Faridabad', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Ahmedabad', 'Goa', 'Lucknow', 'Jaipur', 'Chandigarh', 'Dubai']
const CITY_ALIASES: Record<string, RegExp> = { Gurugram: /\b(gurugram|gurgaon)\b/i, Bengaluru: /\b(bengaluru|bangalore)\b/i }

export const inTopic = (i: Item, t: (typeof TOPICS)[number]) => t.words.test(i.title) || !!i.tags?.includes(t.key)

export function topicShares(items: Item[]) {
  const n = Math.max(1, items.length)
  return Object.fromEntries(TOPICS.map((t) => [t.key, Math.round((items.filter((i) => inTopic(i, t)).length / n) * 100)])) as Record<string, number>
}

export function cityCounts(items: Item[]) {
  return Object.fromEntries(
    CITIES.map((c) => {
      const re = CITY_ALIASES[c] ?? new RegExp(`\\b${c}\\b`, 'i')
      // "Navi Mumbai" and "Greater Noida" are counted on their own, not as Mumbai/Noida too.
      const count = items.filter((i) => re.test(i.title) && !(c === 'Mumbai' && /navi mumbai/i.test(i.title)) && !(c === 'Noida' && /greater noida/i.test(i.title))).length
      return [c, count]
    }),
  ) as Record<string, number>
}

/** Average stories per day, from exact counts when known, else from the date span of the items. */
export function perDay(s: Source): number {
  if (s.posts7 !== undefined) return Math.round((s.posts7 / 7) * 10) / 10
  if (s.items.length < 2) return s.items.length
  const span = (Date.parse(s.items[0].date) - Date.parse(s.items[s.items.length - 1].date)) / DAY
  return Math.round((s.items.length / Math.max(span, 1)) * 10) / 10
}

export function peakHours(items: Item[]): number[] {
  const hours = new Array(24).fill(0)
  // IST is UTC+5:30
  for (const i of items) hours[new Date(Date.parse(i.date) + 5.5 * 3600000).getUTCHours()]++
  return hours
    .map((n, h) => ({ h, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .filter((x) => x.n > 0)
    .map((x) => x.h)
}

export function headlineStyle(items: Item[]) {
  const n = Math.max(1, items.length)
  const words = items.reduce((a, i) => a + i.title.split(/\s+/).length, 0)
  return {
    avgWords: Math.round(words / n),
    withNumbers: Math.round((items.filter((i) => /\d/.test(i.title)).length / n) * 100),
    questions: Math.round((items.filter((i) => /\?$/.test(i.title)).length / n) * 100),
  }
}

const STOP = new Set('the and for with from that this into over amid after says said will have has are its new more than india indian crore year years report percent today about their which what when where how why who could would should also been were your just only upto while under real estate realty property properties housing sector market launches launched launch city cities project projects'.split(' '))
export function hotWords(items: Item[], limit = 15): { word: string; n: number }[] {
  const counts = new Map<string, number>()
  for (const i of items) {
    const seen = new Set<string>()
    for (const w of i.title.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
      if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w) || seen.has(w)) continue
      seen.add(w)
      counts.set(w, (counts.get(w) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, n]) => ({ word, n }))
}

export interface Advice {
  kind: 'gap' | 'strength' | 'volume' | 'city' | 'timing' | 'style'
  text: string
  examples?: Item[]
}

/** Plain-language suggestions from the numbers above; each one is backed by the comparison data. */
export function advise(ours: Source, others: Source[]): Advice[] {
  const advice: Advice[] = []
  const rivals = others.filter((s) => s.items.length >= 5)
  if (!rivals.length) return advice
  const theirItems = rivals.flatMap((s) => s.items)

  const ourRate = perDay(ours)
  const theirRate = Math.round((rivals.reduce((a, s) => a + perDay(s), 0) / rivals.length) * 10) / 10
  if (theirRate > ourRate * 1.2) advice.push({ kind: 'volume', text: `Competitors publish about ${theirRate} stories a day; RealtyNMore about ${ourRate}. Adding ${Math.ceil(theirRate - ourRate)} more short news stories a day would close the gap.` })
  else advice.push({ kind: 'strength', text: `Publishing pace is competitive: RealtyNMore about ${ourRate} stories a day, competitors about ${theirRate}.` })

  const ourMix = topicShares(ours.items)
  const theirMix = topicShares(theirItems)
  for (const t of TOPICS) {
    const diff = theirMix[t.key] - ourMix[t.key]
    if (diff >= 8) {
      advice.push({
        kind: 'gap',
        text: `Cover more ${t.label.toLowerCase()}: ${theirMix[t.key]}% of competitor headlines vs ${ourMix[t.key]}% of yours.`,
        examples: theirItems.filter((i) => inTopic(i, t)).slice(0, 3),
      })
    } else if (diff <= -8) {
      advice.push({ kind: 'strength', text: `Your edge: ${t.label.toLowerCase()}, ${ourMix[t.key]}% of your headlines vs ${theirMix[t.key]}% for competitors. Promote these in the app and on social.` })
    }
  }

  const ourCities = cityCounts(ours.items)
  const theirCities = cityCounts(theirItems)
  const missing = CITIES.filter((c) => theirCities[c] >= 3 && ourCities[c] <= Math.floor(theirCities[c] / 4))
  if (missing.length) advice.push({ kind: 'city', text: `Under-covered cities: ${missing.map((c) => `${c} (them ${theirCities[c]}, you ${ourCities[c]})`).join(', ')}.` })

  const ourPeak = peakHours(ours.items)
  const theirPeak = peakHours(theirItems)
  if (ourPeak.length && theirPeak.length && !theirPeak.includes(ourPeak[0])) {
    const fmt = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
    advice.push({ kind: 'timing', text: `Competitors publish most around ${theirPeak.map(fmt).join(', ')} IST; RealtyNMore around ${ourPeak.map(fmt).join(', ')}. Try putting your strongest story out in their busy hour.` })
  }

  const ourStyle = headlineStyle(ours.items)
  const theirStyle = headlineStyle(theirItems)
  if (theirStyle.withNumbers - ourStyle.withNumbers >= 10) advice.push({ kind: 'style', text: `${theirStyle.withNumbers}% of competitor headlines carry a number (₹, %, sq ft, units) vs ${ourStyle.withNumbers}% of yours. Put the key figure in the headline.` })
  if (ourStyle.avgWords - theirStyle.avgWords >= 3) advice.push({ kind: 'style', text: `Your headlines average ${ourStyle.avgWords} words vs ${theirStyle.avgWords}. Shorter headlines read better on phones and in Google.` })
  return advice
}

/* ---------- the endpoint ---------- */
export async function competitors(env: Env) {
  const [ours, et, ht, nxt, sy] = await Promise.all([
    wordpress(env.SITE_API),
    rss(['https://realty.economictimes.indiatimes.com/rss/topstories', 'https://realty.economictimes.indiatimes.com/rss/residential', 'https://realty.economictimes.indiatimes.com/rss/commercial']),
    rss(['https://www.hindustantimes.com/feeds/rss/real-estate/rssfeed.xml']),
    newsSitemap('https://www.realtynxt.com/news-sitemap.xml'),
    wordpress('https://www.squareyards.com/blog/wp-json/wp/v2'),
  ])
  const week = (items: Item[]) => items.filter((i) => Date.now() - Date.parse(i.date) <= 7 * DAY)
  const sources: Source[] = [
    { name: 'RealtyNMore', items: week(ours?.items ?? []), posts7: ours?.posts7, posts30: ours?.posts30, basis: 'Exact count (website API)' },
    { name: 'ET Realty', items: week(et), basis: `Latest ${et.length} items in 3 RSS feeds` },
    { name: 'Hindustan Times Real Estate', items: week(ht), basis: `Latest ${ht.length} items in RSS` },
    { name: 'RealtyNXT', items: week(nxt), basis: `Latest ${nxt.length} items in news sitemap` },
    { name: 'Square Yards', items: week(sy?.items ?? []), posts7: sy?.posts7, posts30: sy?.posts30, basis: 'Exact count (blog API)' },
  ]
  const [us, ...others] = sources
  return {
    generatedAt: new Date().toISOString(),
    sources: sources.map((s) => ({
      name: s.name,
      basis: s.basis,
      sampled: s.items.length,
      perDay: perDay(s),
      posts30: s.posts30 ?? null,
      topics: topicShares(s.items),
      cities: cityCounts(s.items),
      peakHours: peakHours(s.items),
      style: headlineStyle(s.items),
      latest: s.items.slice(0, 5),
    })),
    topics: TOPICS.map((t) => ({ key: t.key, label: t.label })),
    hotWords: hotWords(others.flatMap((s) => s.items)).map((w) => ({ ...w, ours: us.items.filter((i) => i.title.toLowerCase().includes(w.word)).length })),
    advice: advise(us, others),
  }
}
