// Reader preferences, kept on the device (localStorage). Nothing is sent anywhere.
import { useEffect, useState } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'

export interface Prefs {
  textSize: number // index into TEXT_SIZES
  topics: string[] // curated category slugs
  cities: string[]
  autoOffline: boolean
  onboarded: boolean
  notifyMode: 'all' | 'feed' // alerts for every story, or only My Feed sections and cities
  shareStats: boolean // anonymous usage counts (no personal data)
  lang: 'en' | 'hi'
}

export const TEXT_SIZES = [15.5, 17.5, 19.5, 22]
export const CITIES = ['Gurugram', 'Noida', 'Delhi', 'Mumbai', 'Pune', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Goa', 'Ahmedabad', 'Lucknow']

const KEY = 'rnm-prefs'
const THEME_KEY = 'rnm-theme' // also read by the inline script in index.html
const EVENT = 'rnm:prefs-changed'

export const DEFAULT_PREFS: Prefs = { textSize: 1, topics: [], cities: [], autoOffline: true, onboarded: false, notifyMode: 'all', shareStats: true, lang: 'en' }

export function readPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function writePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode: keep for this session only */
  }
  applyPrefs(next)
  window.dispatchEvent(new Event(EVENT))
  return next
}

export function applyPrefs(p: Prefs = readPrefs()) {
  document.documentElement.style.setProperty('--prose-size', `${TEXT_SIZES[p.textSize] ?? TEXT_SIZES[1]}px`)
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState(readPrefs)
  useEffect(() => {
    const on = () => setPrefs(readPrefs())
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return [prefs, (patch) => setPrefs(writePrefs(patch))]
}

/* ---------- theme ---------- */
export function readTheme(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function effectiveTheme(pref: ThemePref = readTheme()): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function setTheme(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, pref)
  } catch {
    /* ignore */
  }
  if (pref === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = pref
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', effectiveTheme(pref) === 'dark' ? '#0E0E10' : '#141416')
  window.dispatchEvent(new Event(EVENT))
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [theme, set] = useState(readTheme)
  useEffect(() => {
    const on = () => set(readTheme())
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return [theme, setTheme]
}
