// Reads public posts from realtynmore.com (WordPress REST API, read-only).
export interface NewsItem {
  id: number
  title: string
  excerpt: string
  categories: number[]
  image?: string
  link?: string
}

export const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')

const strip = (html: string) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

interface RawPost {
  id: number
  link: string
  title: { rendered: string }
  excerpt?: { rendered: string }
  categories?: number[]
  _embedded?: { 'wp:featuredmedia'?: { source_url?: string; media_details?: { sizes?: Record<string, { source_url: string }> } }[] }
}

export function toItem(p: RawPost): NewsItem {
  const media = p._embedded?.['wp:featuredmedia']?.[0]
  const sizes = media?.media_details?.sizes
  return {
    id: p.id,
    title: decode(p.title.rendered).trim(),
    excerpt: strip(p.excerpt?.rendered ?? '').slice(0, 300),
    categories: p.categories ?? [],
    image: sizes?.medium_large?.source_url ?? sizes?.large?.source_url ?? media?.source_url,
    link: p.link,
  }
}

const FIELDS = 'id,link,title,excerpt,categories,_links,_embedded'

async function get(url: string): Promise<RawPost[]> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'RM-News-App/1.0' } })
  if (!res.ok) throw new Error(`site returned ${res.status}`)
  return (await res.json()) as RawPost[]
}

export async function fetchLatest(api: string): Promise<NewsItem[]> {
  return (await get(`${api}/posts?per_page=10&_embed=wp:featuredmedia&_fields=${FIELDS}`)).map(toItem)
}

/** Stories matching a search (newest first), for picking newsletter stories. */
export async function searchPosts(api: string, q: string): Promise<NewsItem[]> {
  const rows = await get(`${api}/posts?search=${encodeURIComponent(q)}&per_page=12&_embed=wp:featuredmedia&_fields=${FIELDS}`)
  return rows.map(toItem)
}

export async function fetchByIds(api: string, ids: number[]): Promise<NewsItem[]> {
  if (!ids.length) return []
  const rows = await get(`${api}/posts?include=${ids.join(',')}&orderby=include&per_page=${ids.length}&_embed=wp:featuredmedia&_fields=${FIELDS}`)
  return rows.map(toItem)
}
