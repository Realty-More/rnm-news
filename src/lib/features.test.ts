import { describe, expect, it } from 'vitest'
import { addToHistory, continueReading, type HistoryItem } from './history.ts'
import { chunkText } from '../components/Listen.tsx'
import type { Post } from './wp.ts'

const post = (id: number): Post => ({
  id,
  slug: `p${id}`,
  date: '2026-10-24T07:00:00Z',
  modified: '2026-10-24T07:00:00Z',
  link: `https://realtynmore.com/p${id}/`,
  title: `Story ${id}`,
  excerpt: '',
  image: null,
  categories: [],
  content: '<p>body</p>',
})

describe('reading history', () => {
  it('moves re-read stories to the top, keeps furthest progress and drops the body', () => {
    let h: HistoryItem[] = []
    h = addToHistory(h, post(1), 0.5)
    h = addToHistory(h, post(2), 0.2)
    h = addToHistory(h, post(1), 0.1)
    expect(h.map((x) => x.post.id)).toEqual([1, 2])
    expect(h[0].progress).toBe(0.5)
    expect(h[0].post.content).toBeUndefined()
  })

  it('suggests only part-read stories from the last week', () => {
    const now = Date.parse('2026-10-24T10:00:00Z')
    const items: HistoryItem[] = [
      { post: post(1), readAt: '2026-10-24T09:00:00Z', progress: 0.95 },
      { post: post(2), readAt: '2026-10-24T08:00:00Z', progress: 0.4 },
      { post: post(3), readAt: '2026-10-01T08:00:00Z', progress: 0.4 },
    ]
    expect(continueReading(items, now)?.post.id).toBe(2)
    expect(continueReading([items[2]], now)).toBeNull()
  })
})

describe('listen', () => {
  it('splits long text into sentence chunks without losing words', () => {
    const text = 'First sentence here. ' + 'Second one is a little longer than the first. '.repeat(10) + 'Last bit'
    const chunks = chunkText(text, 120)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every((c) => c.length <= 160)).toBe(true)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' ').trim())
  })
})

describe('hindi and links', async () => {
  const { translate, hindiUrl } = await import('./i18n.ts')
  const { screenFor, smartLink } = await import('./stats.ts')
  it('translates with values and falls back to English', () => {
    expect(translate('home.newStories', { n: 3 }, 'hi')).toBe('3 नई ख़बरें')
    expect(translate('home.latest', undefined, 'en')).toBe('Latest')
  })
  it("builds Google's free translation link for site articles", () => {
    expect(hindiUrl('https://realtynmore.com/some-story/')).toBe('https://realtynmore-com.translate.goog/some-story/?_x_tr_sl=en&_x_tr_tl=hi&_x_tr_hl=hi')
  })
  it('maps routes to screen names for usage counts', () => {
    expect(screenFor('/')).toBe('home')
    expect(screenFor('/read/some-slug')).toBe('article')
    expect(screenFor('/category/rera')).toBe('category')
    expect(screenFor('/unknown')).toBeNull()
  })
  it('uses the smart share link when the app server is set', () => {
    expect(smartLink({ id: 5, link: 'https://realtynmore.com/x/' })).toMatch(/\/a\/5$|^https:\/\/realtynmore\.com\/x\/$/)
  })
})
