// Auto-download: keeps the latest stories (full text) on the device so they open without internet.
import { createStore, get, set } from 'idb-keyval'
import { fetchPosts, type Post } from './wp.ts'
import { readPrefs } from './prefs.ts'

const store = createStore('rnm-news-offline', 'latest')
const EVERY_MS = 3 * 60 * 60 * 1000
const COUNT = 20

interface Bundle {
  at: string
  posts: Post[]
}

export async function getOfflinePost(id: number): Promise<Post | undefined> {
  const bundle = await get<Bundle>('bundle', store)
  return bundle?.posts.find((p) => p.id === id)
}

export async function offlineInfo(): Promise<{ at: string; count: number } | null> {
  const bundle = await get<Bundle>('bundle', store)
  return bundle ? { at: bundle.at, count: bundle.posts.length } : null
}

function onMeteredOrSlow(): boolean {
  const c = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return !!c && (c.saveData === true || c.effectiveType === '2g' || c.effectiveType === 'slow-2g')
}

/** Runs at most every 3 hours, only online, and never with Data Saver on. */
export async function refreshOffline(force = false): Promise<number> {
  if (!navigator.onLine || (!force && (!readPrefs().autoOffline || onMeteredOrSlow()))) return 0
  const last = await get<Bundle>('bundle', store)
  if (!force && last && Date.now() - Date.parse(last.at) < EVERY_MS) return 0
  const { posts } = await fetchPosts({ perPage: COUNT, withContent: true })
  await set('bundle', { at: new Date().toISOString(), posts } satisfies Bundle, store)
  // Warm the image cache (the service worker stores them) for the lead images.
  for (const p of posts) if (p.image) void fetch(p.image.src, { mode: 'no-cors' }).catch(() => {})
  return posts.length
}
