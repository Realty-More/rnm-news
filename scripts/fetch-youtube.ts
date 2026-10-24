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

await mkdir(new URL('.', out), { recursive: true })
await writeFile(out, JSON.stringify({ generatedAt: new Date().toISOString(), feeds }))
console.log(`YouTube snapshot written (${failures} feed(s) failed).`)
