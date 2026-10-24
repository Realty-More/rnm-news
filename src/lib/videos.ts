// Loads YouTube feeds the way each platform allows:
//  - dev server: through the Vite proxy (/yt → youtube.com)
//  - Android app: directly, since Capacitor's native HTTP has no CORS limits
//  - hosted PWA: data/youtube.json, refreshed by the GitHub Actions build every 30 minutes
import { Capacitor } from '@capacitor/core'
import { FEEDS, feedUrl, parseFeed, type Feed, type FeedKey, type Video } from './youtubeFeed.ts'

export interface Snapshot {
  generatedAt: string
  feeds: Partial<Record<FeedKey, Feed>>
}

let snapshot: Promise<Snapshot> | null = null

function loadSnapshot(): Promise<Snapshot> {
  snapshot ??= fetch(`${import.meta.env.BASE_URL}data/youtube.json`, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error('Video list is not available right now.')
    return r.json() as Promise<Snapshot>
  })
  snapshot.catch(() => (snapshot = null))
  return snapshot
}

async function fromSnapshot(key: FeedKey): Promise<Feed> {
  const snap = await loadSnapshot()
  const feed = snap.feeds[key]
  if (!feed) throw new Error('Video list is not available right now.')
  return feed
}

async function live(url: string): Promise<Feed> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`YouTube returned ${res.status}`)
  return parseFeed(await res.text())
}

export async function loadFeed(key: FeedKey): Promise<Feed> {
  if (import.meta.env.DEV) return live(`/yt/feeds/videos.xml?${FEEDS[key].query}`)
  if (Capacitor.isNativePlatform()) {
    try {
      return await live(feedUrl(key))
    } catch {
      return fromSnapshot(key) // copy bundled at build time
    }
  }
  return fromSnapshot(key)
}

/** Podcast playlist plus any upload titled as a podcast, newest first, no duplicates. */
export async function loadPodcasts(): Promise<Video[]> {
  const [playlist, latest] = await Promise.allSettled([loadFeed('podcasts'), loadFeed('latest')])
  if (playlist.status === 'rejected' && latest.status === 'rejected') throw playlist.reason
  const items = [
    ...(playlist.status === 'fulfilled' ? playlist.value.videos : []),
    ...(latest.status === 'fulfilled' ? latest.value.videos.filter((v) => /podcast/i.test(v.title)) : []),
  ]
  const seen = new Set<string>()
  return items
    .filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)))
    .sort((a, b) => b.published.localeCompare(a.published))
}

export async function snapshotTime(): Promise<string | null> {
  if (import.meta.env.DEV) return null
  try {
    return (await loadSnapshot()).generatedAt
  } catch {
    return null
  }
}

/** Shorts from all playlists, newest first. Flags come from the build-time snapshot (also served in dev). */
export async function loadShorts(): Promise<Video[]> {
  const snap = await loadSnapshot()
  const seen = new Set<string>()
  return Object.values(snap.feeds)
    .flatMap((f) => f?.videos ?? [])
    .filter((v) => v.isShort && (seen.has(v.id) ? false : (seen.add(v.id), true)))
    .sort((a, b) => b.published.localeCompare(a.published))
}
