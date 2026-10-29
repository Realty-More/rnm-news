// Reader account on this device ("My Realty & More"): sign in with email and password, and keep
// saved stories and feed choices the same on every device. Completely separate from the team's
// R&M Newsroom login (lib/owner.ts): a reader account never opens the Newsroom.
import { useEffect, useState } from 'react'
import { PUSH_API } from './push.ts'
import { readPrefs, writePrefs } from './prefs.ts'
import { applySaved, fillSaved, listSaved, onSavedEdited, removedIds, type SavedPost } from './saved.ts'
import { fetchPost } from './wp.ts'

const KEY = 'rnm-reader'
const EVT = 'rnm:reader-changed'
const PREFS_AT = 'rnm-prefs-at'

export interface ReaderMe {
  name: string
  email: string
  created: string
}
export interface ReaderState {
  token: string
  me: ReaderMe
  syncedAt?: string
  savedCount?: number
}
interface SyncOut {
  saved: SavedPost[]
  removed: Record<string, string>
  prefs: { topics?: string[]; cities?: string[]; notifyMode?: string; lang?: string; textSize?: number; updatedAt?: string }
}

export function readerState(): ReaderState | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as ReaderState | null
    return s?.token?.startsWith('r_') ? s : null
  } catch {
    return null
  }
}
function keep(s: ReaderState | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(EVT))
}

/** The signed-in reader, kept up to date across the app. */
export function useReader(): ReaderState | null {
  const [s, setS] = useState(readerState)
  useEffect(() => {
    const on = () => setS(readerState())
    window.addEventListener(EVT, on)
    window.addEventListener('storage', on)
    return () => {
      window.removeEventListener(EVT, on)
      window.removeEventListener('storage', on)
    }
  }, [])
  return s
}

async function call<T>(path: string, body: unknown = {}, token?: string): Promise<T> {
  if (!PUSH_API) throw new Error('Accounts are not available right now.')
  let res: Response
  try {
    res = await fetch(`${PUSH_API}/reader/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  } catch {
    throw new Error('No internet connection. Please try again.')
  }
  const j = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    // The session ended elsewhere (password reset, account deleted): sign out here too.
    if (token && /sign in again/i.test(j.error ?? '')) keep(null)
    throw new Error(j.error ?? 'Something went wrong. Please try again.')
  }
  return j
}

const signedIn = async (out: { token: string; me: ReaderMe }) => {
  keep({ token: out.token, me: out.me })
  await syncNow().catch(() => {})
}

export const readerSignUp = async (name: string, email: string, password: string) => signedIn(await call('signup', { name, email, password }))
export const readerSignIn = async (email: string, password: string) => signedIn(await call('login', { email, password }))
export const readerForgot = (email: string) => call<{ ok: boolean }>('forgot', { email })
export const readerReset = async (email: string, code: string, password: string) => signedIn(await call('reset', { email, code, password }))

export async function readerSignOut() {
  const s = readerState()
  keep(null)
  if (s) await call('logout', {}, s.token).catch(() => {})
}
export async function readerRename(name: string) {
  const s = readerState()
  if (!s) return
  const out = await call<{ name: string }>('profile', { name }, s.token)
  keep({ ...s, me: { ...s.me, name: out.name } })
}
export async function readerChangePassword(password: string, newPassword: string) {
  const s = readerState()
  if (s) await call('profile', { password, newPassword }, s.token)
}
export async function readerDeleteAccount(password: string) {
  const s = readerState()
  if (!s) return
  await call('delete', { password }, s.token)
  keep(null)
}

/* ---------- sync ---------- */

const lite = (p: SavedPost) => ({ id: p.id, savedAt: p.savedAt, slug: p.slug, date: p.date, link: p.link, title: p.title, excerpt: p.excerpt, image: p.image, categories: p.categories })
const feedOf = () => {
  const p = readPrefs()
  return JSON.stringify({ topics: p.topics, cities: p.cities, notifyMode: p.notifyMode, lang: p.lang, textSize: p.textSize })
}
let applying = false
let lastFeed = ''
let running: Promise<void> | null = null

/** Sends this device's saved stories and feed choices, and brings the account's back. */
export function syncNow(): Promise<void> {
  if (running) return running
  running = (async () => {
    const s = readerState()
    if (!s) return
    const p = readPrefs()
    const prefsAt = localStorage.getItem(PREFS_AT)
    const out = await call<SyncOut>('sync', { saved: (await listSaved()).map(lite), removed: removedIds(), prefs: prefsAt ? { topics: p.topics, cities: p.cities, notifyMode: p.notifyMode, lang: p.lang, textSize: p.textSize, updatedAt: prefsAt } : undefined }, s.token)
    const added = await applySaved(
      out.saved.map((x) => ({ ...x, modified: x.modified ?? x.date }) as SavedPost),
      out.removed,
    )
    if (out.prefs?.updatedAt && out.prefs.updatedAt !== prefsAt) {
      applying = true
      writePrefs({ topics: out.prefs.topics ?? [], cities: out.prefs.cities ?? [], notifyMode: out.prefs.notifyMode === 'feed' ? 'feed' : 'all', lang: out.prefs.lang === 'hi' ? 'hi' : 'en', textSize: out.prefs.textSize ?? 1 })
      localStorage.setItem(PREFS_AT, out.prefs.updatedAt)
      lastFeed = feedOf()
      applying = false
    }
    const now = readerState()
    if (now) keep({ ...now, syncedAt: new Date().toISOString(), savedCount: out.saved.length })
    // Stories saved on another device: fetch their full text quietly so they open offline too.
    for (const a of added.slice(0, 12)) void fetchPost(String(a.id)).then((full) => full && fillSaved(full)).catch(() => {})
  })().finally(() => {
    running = null
  })
  return running
}

let started = false
/** Starts syncing in the background (once per app start). */
export function startReaderSync() {
  if (started) return
  started = true
  lastFeed = feedOf()
  let timer: ReturnType<typeof setTimeout> | undefined
  const soon = (ms = 1500) => {
    if (!readerState()) return
    clearTimeout(timer)
    timer = setTimeout(() => void syncNow().catch(() => {}), ms)
  }
  onSavedEdited(() => soon())
  window.addEventListener('rnm:prefs-changed', () => {
    if (applying) return
    const f = feedOf()
    if (f === lastFeed) return
    lastFeed = f
    try {
      localStorage.setItem(PREFS_AT, new Date().toISOString())
    } catch {
      /* private mode */
    }
    soon()
  })
  window.addEventListener('online', () => soon(500))
  document.addEventListener('visibilitychange', () => {
    const s = readerState()
    if (document.visibilityState === 'visible' && s && (!s.syncedAt || Date.now() - Date.parse(s.syncedAt) > 10 * 60000)) soon(300)
  })
  soon(2000)
}
