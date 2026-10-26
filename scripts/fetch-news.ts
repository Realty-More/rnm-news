// Saves the latest realtynmore.com stories to public/data/news.json before each build,
// so the Home screen can paint real headlines instantly while the live API answers.
// Runs locally (`npm run feeds`) and in the GitHub Actions job every 30 minutes.
import { readFile, writeFile } from 'node:fs/promises'
import { LIST_FIELDS, SITE, type RawPost } from '../src/lib/wp.ts'

/** Keeps only what the app reads, so the file stays small (images: the sizes, terms: categories). */
function slim(p: RawPost): RawPost {
  const media = p._embedded?.['wp:featuredmedia']?.[0]
  const img =
    media && !('code' in media)
      ? [{ source_url: media.source_url, alt_text: media.alt_text, media_details: { width: media.media_details?.width, height: media.media_details?.height, sizes: media.media_details?.sizes } }]
      : []
  const terms = (p._embedded?.['wp:term'] ?? []).map((list) => list.filter((t) => t.taxonomy === 'category').map(({ id, name, slug, taxonomy }) => ({ id, name, slug, taxonomy })))
  return {
    id: p.id,
    slug: p.slug,
    date_gmt: p.date_gmt,
    modified_gmt: p.modified_gmt,
    link: p.link,
    title: { rendered: p.title.rendered },
    excerpt: { rendered: p.excerpt.rendered },
    categories: p.categories,
    _embedded: { 'wp:featuredmedia': img, 'wp:term': terms },
  }
}

const out = new URL('../public/data/news.json', import.meta.url)
const url = `${SITE}/wp-json/wp/v2/posts?per_page=12&_embed=wp:featuredmedia,wp:term&_fields=${LIST_FIELDS}`

try {
  const res = await fetch(url, { headers: { 'User-Agent': 'RealtyNMore-News-App feed fetcher', Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const raw = (await res.json()) as RawPost[]
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('empty list')
  const posts = raw.map(slim)
  await writeFile(out, JSON.stringify({ at: new Date().toISOString(), posts }))
  console.log(`  news: ${posts.length} stories`)
} catch (err) {
  // Keep the last good copy; the app still loads live news either way.
  const kept = await readFile(out, 'utf8').then(() => true, () => false)
  if (!kept) await writeFile(out, JSON.stringify({ at: null, posts: [] }))
  console.warn(`  news: failed (${(err as Error).message})${kept ? ', kept previous copy' : ''}`)
}
