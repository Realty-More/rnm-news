// Read-only client for the public WordPress REST API on realtynmore.com.
import { cleanExcerpt, decodeEntities, gmtToIso } from './format.ts'

export const SITE = 'https://realtynmore.com'
const API = `${SITE}/wp-json/wp/v2`

export interface Category {
  id: number
  name: string
  slug: string
  count: number
  description: string
  link: string
}

export interface PostImage {
  src: string
  srcSet: string
  width?: number
  height?: number
  alt: string
}

export interface Post {
  id: number
  slug: string
  date: string
  modified: string
  link: string
  title: string
  excerpt: string
  image: PostImage | null
  categories: { id: number; name: string; slug: string }[]
  content?: string
}

/**
 * Categories the site still publishes in (checked 24 Oct 2026). Legacy or empty ones
 * such as "Budget 2015-16", "test" and "ads" are left out on purpose.
 */
export const CURATED_CATEGORIES: { id: number; slug: string; label: string }[] = [
  { id: 1, slug: 'news', label: 'News' },
  { id: 14, slug: 'interviews', label: 'Interviews' },
  { id: 439, slug: 'rera', label: 'RERA' },
  { id: 40460, slug: 'leadership-updates', label: 'Leadership Updates' },
  { id: 11, slug: 'guest-column', label: 'Guest Column' },
  { id: 40322, slug: 'blogs', label: 'Insights' },
  { id: 196, slug: 'report', label: 'Reports' },
  { id: 4, slug: 'launches', label: 'New Launches' },
  { id: 38, slug: 'developer-speak', label: 'Developers Speak' },
  { id: 12, slug: 'events', label: 'Events' },
  { id: 34, slug: 'top-stories', label: 'Top Stories' },
]

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const LIST_FIELDS = 'id,slug,date_gmt,modified_gmt,link,title,excerpt,categories,featured_media,_links,_embedded'
const FULL_FIELDS = `${LIST_FIELDS},content`

async function getJson<T>(path: string, signal?: AbortSignal): Promise<{ data: T; totalPages: number }> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, { signal, headers: { Accept: 'application/json' } })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, navigator.onLine === false ? 'You are offline.' : 'Could not reach realtynmore.com.')
  }
  // WordPress answers 400 when a page number runs past the end.
  if (res.status === 400 && /[?&]page=\d+/.test(path)) return { data: [] as T, totalPages: 0 }
  if (!res.ok) throw new ApiError(res.status, `realtynmore.com returned an error (${res.status}).`)
  const totalPages = Number(res.headers.get('X-WP-TotalPages') ?? '1')
  return { data: (await res.json()) as T, totalPages }
}

/* ---------- raw API shapes (only the fields we read) ---------- */
interface RawMedia {
  source_url?: string
  alt_text?: string
  media_details?: { width?: number; height?: number; sizes?: Record<string, { source_url: string; width: number; height: number }> }
}
interface RawTerm { id: number; name: string; slug: string; taxonomy: string }
export interface RawPost {
  id: number
  slug: string
  date_gmt: string
  modified_gmt: string
  link: string
  title: { rendered: string }
  excerpt: { rendered: string }
  content?: { rendered: string }
  categories: number[]
  _embedded?: { 'wp:featuredmedia'?: (RawMedia | { code: string })[]; 'wp:term'?: RawTerm[][] }
}

export function toImage(media: RawMedia | { code: string } | undefined, alt: string): PostImage | null {
  if (!media || 'code' in media || !media.source_url) return null
  const sizes = media.media_details?.sizes ?? {}
  const candidates = Object.values(sizes)
    .filter((s) => s.width >= 300)
    .sort((a, b) => a.width - b.width)
  const seen = new Set<number>()
  const srcSet = candidates
    .filter((s) => (seen.has(s.width) ? false : (seen.add(s.width), true)))
    .map((s) => `${s.source_url} ${s.width}w`)
    .join(', ')
  // Prefer a mid-size file as the fallback src; "full" uploads can be several MB.
  const mid = candidates.find((s) => s.width >= 700) ?? candidates[candidates.length - 1]
  return {
    src: mid?.source_url ?? media.source_url,
    srcSet,
    width: mid?.width ?? media.media_details?.width,
    height: mid?.height ?? media.media_details?.height,
    alt: decodeEntities(media.alt_text || '') || alt,
  }
}

export function toPost(raw: RawPost): Post {
  const title = decodeEntities(raw.title.rendered)
  const terms = raw._embedded?.['wp:term']?.flat().filter((t) => t.taxonomy === 'category') ?? []
  return {
    id: raw.id,
    slug: raw.slug,
    date: gmtToIso(raw.date_gmt),
    modified: gmtToIso(raw.modified_gmt),
    link: raw.link,
    title,
    excerpt: cleanExcerpt(raw.excerpt.rendered),
    image: toImage(raw._embedded?.['wp:featuredmedia']?.[0], title),
    categories: terms.map((t) => ({ id: t.id, name: decodeEntities(t.name), slug: t.slug })),
    content: raw.content?.rendered,
  }
}

export interface PostQuery {
  page?: number
  perPage?: number
  category?: number
  /** Posts in any of these categories (used by My Feed). */
  categories?: number[]
  search?: string
  exclude?: number[]
  withContent?: boolean
}

export async function fetchPosts(q: PostQuery = {}, signal?: AbortSignal): Promise<{ posts: Post[]; totalPages: number }> {
  const params = new URLSearchParams({
    per_page: String(q.perPage ?? 12),
    page: String(q.page ?? 1),
    _embed: 'wp:featuredmedia,wp:term',
    _fields: q.withContent ? FULL_FIELDS : LIST_FIELDS,
  })
  const cats = q.category ? [q.category] : q.categories ?? []
  if (cats.length) params.set('categories', cats.join(','))
  if (q.search) params.set('search', q.search)
  if (q.exclude?.length) params.set('exclude', q.exclude.join(','))
  const { data, totalPages } = await getJson<RawPost[]>(`/posts?${params}`, signal)
  return { posts: data.map(toPost), totalPages }
}

export async function fetchPost(idOrSlug: string, signal?: AbortSignal): Promise<Post | null> {
  const params = new URLSearchParams({ _embed: 'wp:featuredmedia,wp:term', _fields: FULL_FIELDS })
  if (/^\d+$/.test(idOrSlug)) {
    try {
      const { data } = await getJson<RawPost>(`/posts/${idOrSlug}?${params}`, signal)
      return toPost(data)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }
  params.set('slug', idOrSlug)
  const { data } = await getJson<RawPost[]>(`/posts?${params}`, signal)
  return data[0] ? toPost(data[0]) : null
}

interface RawCategory { id: number; name: string; slug: string; count: number; description: string; link: string }

export async function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  const ids = CURATED_CATEGORIES.map((c) => c.id).join(',')
  const { data } = await getJson<RawCategory[]>(`/categories?include=${ids}&per_page=50&_fields=id,name,slug,count,description,link`, signal)
  const byId = new Map(data.map((c) => [c.id, c]))
  return CURATED_CATEGORIES.flatMap((c) => {
    const raw = byId.get(c.id)
    if (!raw) return []
    return [{ id: raw.id, slug: raw.slug, name: c.label, count: raw.count, description: stripTags(raw.description), link: raw.link }]
  })
}

function stripTags(s: string) {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).trim()
}

export function categoryBySlug(slug: string) {
  return CURATED_CATEGORIES.find((c) => c.slug === slug)
}

/** realtynmore.com post URL → slug, so links inside articles can open in the app. */
export function slugFromSiteUrl(href: string): string | null {
  try {
    const url = new URL(href, SITE)
    if (url.hostname.replace(/^www\./, '') !== 'realtynmore.com') return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 1 || /\.[a-z0-9]+$/i.test(parts[0])) return null
    return parts[0]
  } catch {
    return null
  }
}
