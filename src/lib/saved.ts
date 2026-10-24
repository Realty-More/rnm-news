// Saved articles live in IndexedDB on the device, including the full text, so they open offline.
import { createStore, del, entries, get, set } from 'idb-keyval'
import type { Post } from './wp.ts'

export interface SavedPost extends Post {
  savedAt: string
}

const store = createStore('rnm-news', 'saved')
const EVENT = 'rnm:saved-changed'

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
  window.dispatchEvent(new Event(EVENT))
}

export async function removeSaved(id: number): Promise<void> {
  await del(id, store)
  window.dispatchEvent(new Event(EVENT))
}

export function onSavedChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
