// Anonymous usage counts sent to the app server: which screens are opened and which stories are read.
// No ids, names or device details; readers can switch it off in Settings ▸ Privacy.
import { PUSH_API } from './push.ts'
import { readPrefs } from './prefs.ts'
import { fetchPosts, type Post } from './wp.ts'

const OPENED_KEY = 'rnm-opened'

function send(body: object) {
  if (!PUSH_API || !readPrefs().shareStats || navigator.onLine === false) return
  const data = JSON.stringify(body)
  // keepalive lets the request finish even if the screen changes right away
  void fetch(`${PUSH_API}/hit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data, keepalive: true }).catch(() => {})
}

export function screenFor(pathname: string): string | null {
  const first = pathname.split('/')[1] || 'home'
  const map: Record<string, string> = { read: 'article', category: 'category' }
  const page = map[first] ?? first
  return ['home', 'news', 'categories', 'category', 'search', 'article', 'videos', 'shorts', 'podcasts', 'saved', 'settings'].includes(page) ? page : null
}

export function trackScreen(pathname: string) {
  const page = screenFor(pathname)
  if (page) send({ kind: 'page', page })
}

/** Counts a story once per device per day, so refreshing can't inflate "Trending". */
export function trackOpen(postId: number) {
  const day = new Date().toISOString().slice(0, 10)
  let seen: { day: string; ids: number[] } = { day, ids: [] }
  try {
    const stored = JSON.parse(localStorage.getItem(OPENED_KEY) ?? 'null')
    if (stored?.day === day) seen = stored
  } catch {
    /* ignore */
  }
  if (seen.ids.includes(postId)) return
  seen.ids.push(postId)
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify(seen))
  } catch {
    /* ignore */
  }
  send({ kind: 'open', postId })
}

/** Stories readers opened most in the app over the last 2 days. */
export async function fetchTrending(signal?: AbortSignal): Promise<Post[]> {
  if (!PUSH_API) return []
  const res = await fetch(`${PUSH_API}/trending`, { signal })
  if (!res.ok) return []
  const { items } = (await res.json()) as { items: { id: number; opens: number }[] }
  if (items.length < 3) return []
  const { posts } = await fetchPosts({ include: items.map((i) => i.id), perPage: items.length }, signal)
  return posts
}

/** Link that shows a title-and-photo preview in WhatsApp and opens the story in the app. */
export function smartLink(post: { id: number; link: string }): string {
  return PUSH_API ? `${PUSH_API}/a/${post.id}` : post.link
}

/** What readers search for in the app, and whether it found anything (shows content gaps to the owner). */
export function trackSearch(q: string, empty: boolean) {
  send({ kind: 'search', q, empty })
}

/** Counts shares per story (share sheet, WhatsApp or copied link) for the owner's performance view. */
export function trackShare(postId: number, channel: 'share' | 'whatsapp' | 'copy') {
  send({ kind: 'share', postId, channel })
}
