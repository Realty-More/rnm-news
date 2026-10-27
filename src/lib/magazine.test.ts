import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_SITE, loadMagazine, magazineSources } from './magazine.ts'

const list = { issues: [{ id: 1, title: 'April–June 2026', period: '2026-06', kind: 'quarterly', uploaded: '', pages: 104, bytes: 1, url: '', cover: 'magazine/1.jpg' }] }

afterEach(() => vi.unstubAllGlobals())

describe('magazine list', () => {
  it('reads the live site first in the Android app, its own copy on the web', () => {
    expect(magazineSources(true, './')).toEqual([LIVE_SITE, './'])
    expect(magazineSources(false, './')).toEqual(['./'])
  })
  it('makes cover addresses full, next to the list they came from', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(list))))
    const issues = await loadMagazine(undefined, [LIVE_SITE, './'])
    expect(issues[0].cover).toBe(`${LIVE_SITE}magazine/1.jpg`)
  })
  it('falls back to the copy inside the app when offline', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.startsWith('https://')) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify(list))
    })
    vi.stubGlobal('fetch', f)
    const issues = await loadMagazine(undefined, [LIVE_SITE, './'])
    expect(f).toHaveBeenCalledTimes(2)
    expect(issues[0].cover).toBe('./magazine/1.jpg')
  })
  it('says so when no copy is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(loadMagazine(undefined, ['./'])).rejects.toThrow('Magazine list unavailable.')
  })
})
