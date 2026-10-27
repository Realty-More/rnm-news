// R&M Magazine issue list (built from realtynmore.com every 30 minutes into data/magazine.json).
// The website version reads its own copy. The Android app reads the live site first, so a new
// issue shows up without an app update, and falls back to the copy inside the app when offline.
import { Capacitor } from '@capacitor/core'

export const LIVE_SITE = 'https://realty-more.github.io/rnm-news/'

export interface Issue {
  id: number
  title: string
  period: string
  kind: 'quarterly' | 'special' | 'archive'
  uploaded: string
  pages: number
  bytes: number
  url: string
  /** Full address of the cover image. */
  cover: string
}

/** Where to look for the list, in order. */
export function magazineSources(native = Capacitor.isNativePlatform(), local = import.meta.env.BASE_URL): string[] {
  return native ? [LIVE_SITE, local] : [local]
}

export async function loadMagazine(signal?: AbortSignal, sources = magazineSources()): Promise<Issue[]> {
  for (const base of sources) {
    try {
      const r = await fetch(`${base}data/magazine.json`, { signal, cache: 'no-cache' })
      if (!r.ok) throw new Error(`magazine list ${r.status}`)
      const { issues } = (await r.json()) as { issues: Issue[] }
      // Covers live next to the list they came with.
      return issues.map((i) => ({ ...i, cover: /^https?:/.test(i.cover) ? i.cover : `${base}${i.cover}` }))
    } catch (e) {
      if (signal?.aborted) throw e
      // Try the next source.
    }
  }
  throw new Error('Magazine list unavailable.')
}
