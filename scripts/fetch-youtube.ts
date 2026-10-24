// Saves the RealtyNMore YouTube feeds to public/data/youtube.json before each build.
// Runs locally (`npm run feeds`) and in the GitHub Actions job every 30 minutes.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { FEEDS, feedUrl, parseFeed, type Feed, type FeedKey } from '../src/lib/youtubeFeed.ts'

const out = new URL('../public/data/youtube.json', import.meta.url)

let previous: { feeds?: Partial<Record<FeedKey, Feed>> } = {}
try {
  previous = JSON.parse(await readFile(out, 'utf8'))
} catch {
  // first run
}

const feeds: Partial<Record<FeedKey, Feed>> = {}
let failures = 0
for (const key of Object.keys(FEEDS) as FeedKey[]) {
  try {
    const res = await fetch(feedUrl(key), { headers: { 'User-Agent': 'RealtyNMore-News-App feed fetcher' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    feeds[key] = parseFeed(await res.text())
    console.log(`  ${key}: ${feeds[key]!.videos.length} videos`)
  } catch (err) {
    failures++
    // Keep the last good copy rather than publishing an empty list.
    if (previous.feeds?.[key]) feeds[key] = previous.feeds[key]
    console.warn(`  ${key}: failed (${(err as Error).message})${feeds[key] ? ', kept previous copy' : ''}`)
  }
}

// The feed doesn't mark Shorts: youtube.com/shorts/<id> answers 200 for a Short and redirects otherwise.
const shortCache = new Map<string, boolean>()
for (const feed of Object.values(previous.feeds ?? {})) for (const v of feed.videos) if (v.isShort !== undefined) shortCache.set(v.id, v.isShort)
async function isShort(id: string): Promise<boolean | undefined> {
  if (shortCache.has(id)) return shortCache.get(id)
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${id}`, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } })
    const value = res.status === 200 ? true : res.status >= 300 && res.status < 400 ? false : undefined
    if (value !== undefined) shortCache.set(id, value)
    return value
  } catch {
    return undefined
  }
}
const ids = [...new Set(Object.values(feeds).flatMap((f) => f!.videos.map((v) => v.id)))]
for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map(isShort))
for (const feed of Object.values(feeds)) for (const v of feed!.videos) v.isShort = shortCache.get(v.id)
console.log(`  shorts: ${[...shortCache.values()].filter(Boolean).length} of ${ids.length} videos`)

await mkdir(new URL('.', out), { recursive: true })
await writeFile(out, JSON.stringify({ generatedAt: new Date().toISOString(), feeds }))
console.log(`YouTube snapshot written (${failures} feed(s) failed).`)
