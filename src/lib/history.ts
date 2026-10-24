// Reading history on this device: what was opened and how far it was read.
import type { Post } from './wp.ts'

export interface HistoryItem {
  post: Post // list fields only, no article body
  readAt: string
  progress: number // 0..1
}

const KEY = 'rnm-history'
const MAX = 60
const EVENT = 'rnm:history-changed'

export function readHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

function write(items: HistoryItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)))
  } catch {
    /* storage full or blocked */
  }
  window.dispatchEvent(new Event(EVENT))
}

/** Moves the post to the top; keeps the furthest progress reached. */
export function addToHistory(items: HistoryItem[], post: Post, progress: number, now = new Date()): HistoryItem[] {
  const prev = items.find((h) => h.post.id === post.id)
  const { content: _content, ...light } = post
  const entry: HistoryItem = { post: light, readAt: now.toISOString(), progress: Math.max(prev?.progress ?? 0, Math.min(1, progress)) }
  return [entry, ...items.filter((h) => h.post.id !== post.id)].slice(0, MAX)
}

export function recordRead(post: Post, progress = 0) {
  write(addToHistory(readHistory(), post, progress))
}

export function clearHistory() {
  write([])
}

/** Most recent story left part-way through in the last week. */
export function continueReading(items: HistoryItem[], now = Date.now()): HistoryItem | null {
  const week = 7 * 24 * 60 * 60 * 1000
  return items.find((h) => h.progress > 0.08 && h.progress < 0.85 && now - Date.parse(h.readAt) < week) ?? null
}

export function onHistoryChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
