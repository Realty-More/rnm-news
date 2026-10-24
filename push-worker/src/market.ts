// "Why is it moving?" for realty stocks: recent headlines that name the company, from public RSS feeds of
// business and real-estate news sites plus RealtyNMore's own stories. We only list news; we never state a reason.
import { XMLParser } from 'fast-xml-parser'
import { decode } from './site.ts'
import type { Env } from './index.ts'

export const STOCKS: { symbol: string; name: string; match: RegExp }[] = [
  { symbol: 'ABREL', name: 'Aditya Birla Real Estate', match: /(Aditya Birla Real Estate|Birla Estates|Century Textiles)/i },
  { symbol: 'DLF', name: 'DLF', match: /\bDLF\b/ },
  { symbol: 'GODREJPROP', name: 'Godrej Properties', match: /\bGodrej Propert/i },
  { symbol: 'LODHA', name: 'Lodha', match: /\b(Lodha|Macrotech)\b/i },
  { symbol: 'OBEROIRLTY', name: 'Oberoi Realty', match: /\bOberoi Realty\b/i },
  { symbol: 'PRESTIGE', name: 'Prestige', match: /\bPrestige (Estates|Group)\b/i },
  { symbol: 'PHOENIXLTD', name: 'Phoenix Mills', match: /\bPhoenix Mills\b/i },
  { symbol: 'BRIGADE', name: 'Brigade', match: /\bBrigade (Enterprises|Group)\b/i },
  { symbol: 'SOBHA', name: 'Sobha', match: /\bSobha\b/i },
  { symbol: 'ANANTRAJ', name: 'Anant Raj', match: /\bAnant Raj\b/i },
  { symbol: 'SIGNATURE', name: 'Signature Global', match: /\bSignature Global\b/i },
  { symbol: 'MAHLIFE', name: 'Mahindra Lifespace', match: /\bMahindra Lifespace/i },
  { symbol: 'SUNTECK', name: 'Sunteck', match: /\bSunteck\b/i },
  { symbol: 'KOLTEPATIL', name: 'Kolte-Patil', match: /\bKolte[- ]?Patil\b/i },
]
const SECTOR = /\b(nifty realty|realty (index|stocks|shares|sector)|real estate (stocks|shares)|bse realty)\b/i

const FEEDS: { source: string; url: string; sitemap?: boolean }[] = [
  { source: 'ET Realty', url: 'https://realty.economictimes.indiatimes.com/rss/topstories' },
  { source: 'ET Realty', url: 'https://realty.economictimes.indiatimes.com/rss/residential' },
  { source: 'ET Realty', url: 'https://realty.economictimes.indiatimes.com/rss/commercial' },
  { source: 'Economic Times', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { source: 'Economic Times', url: 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms' },
  { source: 'Mint', url: 'https://www.livemint.com/rss/markets' },
  { source: 'Mint', url: 'https://www.livemint.com/rss/companies' },
  { source: 'BusinessLine', url: 'https://www.thehindubusinessline.com/markets/feeder/default.rss' },
  { source: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss' },
  { source: 'Hindustan Times', url: 'https://www.hindustantimes.com/feeds/rss/real-estate/rssfeed.xml' },
  { source: 'RealtyNXT', url: 'https://www.realtynxt.com/news-sitemap.xml', sitemap: true },
]

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' })
const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])
const text = (v: unknown): string => (typeof v === 'object' && v !== null && '#text' in v ? String((v as Record<string, unknown>)['#text']) : v == null ? '' : String(v))
const WINDOW_MS = 3 * 86400000

export interface Headline {
  title: string
  source: string
  link: string
  date: string
}

async function feed(f: (typeof FEEDS)[number]): Promise<Headline[]> {
  try {
    const res = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RM-News-App/1.0)' } })
    if (!res.ok) return []
    const doc = xml.parse(await res.text())
    if (f.sitemap) {
      return asArray(doc?.urlset?.url).map((u) => ({
        title: decode(text(u['news:news']?.['news:title'])).trim(),
        source: f.source,
        link: text(u.loc),
        date: new Date(text(u['news:news']?.['news:publication_date'])).toISOString(),
      }))
    }
    return asArray(doc?.rss?.channel?.item ?? doc?.feed?.entry).flatMap((it) => {
      const d = new Date(text(it.pubDate ?? it.updated ?? it.published))
      if (Number.isNaN(d.getTime())) return []
      const link = typeof it.link === 'object' ? text(it.link?.['@href'] ?? it.link) : text(it.link)
      return [{ title: decode(text(it.title)).replace(/\s+/g, ' ').trim(), source: f.source, link, date: d.toISOString() }]
    })
  } catch {
    return []
  }
}

async function ours(env: Env): Promise<Headline[]> {
  try {
    const after = new Date(Date.now() - WINDOW_MS).toISOString().slice(0, 19)
    const res = await fetch(`${env.SITE_API}/posts?after=${after}&per_page=100&_fields=id,title,date_gmt`)
    if (!res.ok) return []
    const rows = (await res.json()) as { id: number; title: { rendered: string }; date_gmt: string }[]
    return rows.map((r) => ({ title: decode(r.title.rendered), source: 'RealtyNMore', link: `#/article/${r.id}`, date: `${r.date_gmt}Z` }))
  } catch {
    return []
  }
}

/** Recent headlines that name each company (RealtyNMore first), newest first, no duplicates. */
export function matchNews(pool: Headline[], now = Date.now()) {
  const fresh = pool.filter((h) => h.title && now - Date.parse(h.date) <= WINDOW_MS)
  const seen = new Set<string>()
  const unique = fresh
    .sort((a, b) => (a.source === 'RealtyNMore' ? -1 : 0) - (b.source === 'RealtyNMore' ? -1 : 0) || b.date.localeCompare(a.date))
    .filter((h) => {
      const k = h.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)
      return seen.has(k) ? false : (seen.add(k), true)
    })
  return {
    sector: unique.filter((h) => SECTOR.test(h.title)).slice(0, 5),
    stocks: STOCKS.map((s) => ({ symbol: s.symbol, name: s.name, news: unique.filter((h) => s.match.test(h.title)).slice(0, 4) })),
  }
}

export async function marketNews(env: Env) {
  const lists = await Promise.all([ours(env), ...FEEDS.map(feed)])
  return { generatedAt: new Date().toISOString(), sources: [...new Set(FEEDS.map((f) => f.source))], ...matchNews(lists.flat()) }
}

/** Nifty Realty constituents from NSE's published list (company names and symbols only, no prices). */
export const NIFTY_REALTY_FALLBACK = [
  { symbol: 'ABREL', name: 'Aditya Birla Real Estate' },
  { symbol: 'ANANTRAJ', name: 'Anant Raj' },
  { symbol: 'BRIGADE', name: 'Brigade' },
  { symbol: 'DLF', name: 'DLF' },
  { symbol: 'GODREJPROP', name: 'Godrej Properties' },
  { symbol: 'LODHA', name: 'Lodha' },
  { symbol: 'OBEROIRLTY', name: 'Oberoi Realty' },
  { symbol: 'PHOENIXLTD', name: 'Phoenix Mills' },
  { symbol: 'PRESTIGE', name: 'Prestige' },
  { symbol: 'SOBHA', name: 'Sobha' },
]

/** "Godrej Properties Ltd." -> "Godrej Properties"; "Prestige Estates Projects Ltd." -> "Prestige Estates Projects". */
export const shortName = (company: string) => company.replace(/\s+(Ltd\.?|Limited)$/i, '').trim()

export function parseConstituents(csv: string): { symbol: string; name: string }[] {
  const lines = csv.trim().split(/\r?\n/)
  const header = lines.shift()?.split(',').map((h) => h.trim().toLowerCase()) ?? []
  const iName = header.indexOf('company name')
  const iSym = header.indexOf('symbol')
  if (iName < 0 || iSym < 0) return []
  return lines
    .map((l) => l.split(','))
    .filter((c) => c[iSym] && /^[A-Z0-9&-]+$/.test(c[iSym].trim()))
    .map((c) => ({ symbol: c[iSym].trim(), name: shortName(c[iName]) }))
}

export async function niftyRealty() {
  try {
    const res = await fetch('https://nsearchives.nseindia.com/content/indices/ind_niftyrealtylist.csv', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RM-News-App/1.0)' } })
    const list = res.ok ? parseConstituents(await res.text()) : []
    if (list.length >= 5) return { source: 'NSE', updated: new Date().toISOString(), stocks: list }
  } catch {
    /* fall back below */
  }
  return { source: 'fallback', updated: null, stocks: NIFTY_REALTY_FALLBACK }
}
