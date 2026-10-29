// Saved articles live in IndexedDB on the device, including the full text, so they open offline.
// When a reader is signed in, the list also follows them to their other devices (see reader.ts):
// removals are remembered for a while so another device does not bring a story back.
import { createStore, del, entries, get, set } from 'idb-keyval'
import type { Post } from './wp.ts'

export interface SavedPost extends Post {
  savedAt: string
}

const store = createStore('rnm-news', 'saved')
/** The reader saved or removed a story here. */
const EVENT = 'rnm:saved-changed'
/** The list changed because of a sync from another device. */
const SYNCED = 'rnm:saved-synced'
const REMOVED_KEY = 'rnm-saved-removed'

/** Stories removed on this device and when (for sync). */
export function removedIds(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(REMOVED_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}
function setRemoved(map: Record<string, string>) {
  try {
    localStorage.setItem(REMOVED_KEY, JSON.stringify(map))
  } catch {
    /* private mode */
  }
}

export async function listSaved(): Promise<SavedPost[]> {
  const all = await entries<number, SavedPost>(store)
  return all.map(([, v]) => v).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export async function isSaved(id: number): Promise<boolean> {
  return (await get(id, store)) !== undefined
}

export async function getSaved(id: number): Promise<SavedPost | undefined> {
  return get<SavedPost>(id, store)
}

export async function savePost(post: Post): Promise<void> {
  await set(post.id, { ...post, savedAt: new Date().toISOString() }, store)
  const r = removedIds()
  if (r[post.id]) {
    delete r[post.id]
    setRemoved(r)
  }
  window.dispatchEvent(new Event(EVENT))
}

export async function removeSaved(id: number): Promise<void> {
  await del(id, store)
  setRemoved({ ...removedIds(), [id]: new Date().toISOString() })
  window.dispatchEvent(new Event(EVENT))
}

/** Puts the account's list on this device, keeping full copies already here. Returns the new ones. */
export async function applySaved(list: SavedPost[], removed: Record<string, string>): Promise<SavedPost[]> {
  const here = new Map((await listSaved()).map((p) => [p.id, p]))
  const keep = new Set(list.map((p) => p.id))
  const added: SavedPost[] = []
  for (const p of list) {
    const local = here.get(p.id)
    if (!local) {
      await set(p.id, p, store)
      added.push(p)
    } else if (local.savedAt !== p.savedAt) await set(p.id, { ...local, savedAt: p.savedAt }, store)
  }
  for (const id of here.keys()) if (!keep.has(id)) await del(id, store)
  setRemoved(removed)
  window.dispatchEvent(new Event(SYNCED))
  return added
}

/** Adds the full text to a saved story that came from another device, so it opens offline too. */
export async function fillSaved(post: Post): Promise<void> {
  const local = await get<SavedPost>(post.id, store)
  if (local && !local.content && post.content) await set(post.id, { ...local, ...post, savedAt: local.savedAt }, store)
}

/** Any change to the list (by the reader or by a sync), for screens that show it. */
export function onSavedChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  window.addEventListener(SYNCED, fn)
  return () => {
    window.removeEventListener(EVENT, fn)
    window.removeEventListener(SYNCED, fn)
  }
}

/** Only the reader's own saves and removals here (these are what get synced). */
export function onSavedEdited(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
