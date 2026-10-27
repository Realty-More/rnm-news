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

describe('social captions', async () => {
  const { hashtags, captionsFor } = await import('./captions.ts')
  const post = { title: 'UP RERA Approves 15 Projects in Noida and Gurugram as DLF Expands', excerpt: 'Lucknow, Oct 14: The Uttar Pradesh Real Estate Regulatory Authority approved 15 projects worth Rs 1,226 crore.', categories: [{ id: 439, name: 'RERA', slug: 'rera' }] }
  it('uses at most 5 hashtags and ends with #RealtyNMore', () => {
    const t = hashtags(post)
    expect(t.length).toBeLessThanOrEqual(5)
    expect(t[0]).toBe('#RealEstate')
    expect(t).toContain('#RERA')
    expect(t[t.length - 1]).toBe('#RealtyNMore')
  })
  it('keeps the X post within 280 characters (links count as 23)', () => {
    const c = captionsFor({ ...post, title: post.title.repeat(6) }, 'https://rnm-news-push.realtynmore.workers.dev/a/119112')
    const counted = c.x.replace(/https:\/\/\S+/, 'x'.repeat(23))
    expect(counted.length).toBeLessThanOrEqual(280)
    expect(c.instagram).toMatch(/link in bio/)
    expect(c.linkedin).toMatch(/realtynmore\.workers\.dev\/a\/119112/)
  })
})

describe('attendance export', async () => {
  const { monthCsv } = await import('../pages/TeamTools.tsx')
  it('builds a CSV with one column per day of the month', () => {
    const csv = monthCsv({
      month: '2026-02',
      settings: { startTime: '10:00', graceMin: 15 },
      rows: [
        {
          id: 'a',
          name: 'Neha "Desk"',
          present: 1,
          late: 1,
          reports: 1,
          minutes: 510,
          avgCheckIn: '10:20',
          workingDays: 20,
          leave: 1.5,
          leaveByKind: { 'Sick leave': 1, 'Casual leave': 0.5 },
          absent: 2,
          days: { '2026-02-03': { in: '10:20', out: '18:50', late: true, report: true }, '2026-02-04': { in: null, out: null, late: false, report: false, leave: 'Sick leave' } },
        },
      ],
    })
    const [head, row] = csv.split('\r\n')
    expect(head.split(',').length).toBe(10 + 28)
    expect(row).toContain('"Sick leave 1; Casual leave 0.5"')
    expect(row).toContain('"Leave: Sick leave"')
    expect(row).toContain('"Neha ""Desk"""')
    expect(row).toContain('"10:20-18:50 L"')
    expect(row).toContain('"8.5"')
  })
})

import { keyPoints, sentences } from './keypoints.ts'
import { mailingCsv, nextQuarter, prevQuarter } from '../pages/MagazineTools.tsx'

describe('key points', () => {
  const story =
    '<p>New Delhi, October 26, 2026: India’s office market saw demand spread across sectors in Q3 2026, according to Vestian Research.</p>' +
    '<p>IT-ITeS remained the largest contributor, but its share fell to 23% from 41% in Q2 2026.</p>' +
    '<p>“We are seeing a healthy mix of occupiers this year,” said the chief executive of the firm.</p>' +
    '<p>The share of BFSI rose to 20% from 8% in the previous quarter and 15% a year earlier.</p>' +
    '<p>Flex spaces kept a steady share of absorption across the major cities during the quarter.</p>' +
    '<p>Absorption reached 23.7 million sq ft, up 20% year-on-year, the second-highest on record.</p>' +
    '<p>By Varun Baweja, Director, Fomerah Ventures Pvt. Ltd.</p>'
  it('keeps the lede and the sentences with numbers, in story order, minus the dateline', () => {
    const pts = keyPoints(story)
    expect(pts).toHaveLength(3)
    expect(pts[0]).toMatch(/^India’s office market/)
    expect(pts.some((p) => p.includes('said'))).toBe(false)
    expect(pts.some((p) => p.startsWith('By '))).toBe(false)
  })
  it('skips short pieces', () => {
    expect(keyPoints('<p>Short note one here for the readers today.</p><p>And a second line follows here.</p>')).toEqual([])
  })
  it('does not split on Rs. or decimals', () => {
    expect(sentences('Orders worth Rs. 949 crore came in. Growth was 23.7 per cent.')).toEqual(['Orders worth Rs. 949 crore came in.', 'Growth was 23.7 per cent.'])
  })
})

describe('magazine list', () => {
  it('rolls over to the next quarter', () => {
    expect(nextQuarter('2026-Q4')).toEqual({ id: '2027-Q1', title: 'Jan–Mar 2027' })
    expect(nextQuarter('2027-Q2')).toEqual({ id: '2027-Q3', title: 'Jul–Sep 2027' })
    expect(prevQuarter('2026-Q4')).toEqual({ id: '2026-Q3', title: 'Jul–Sep 2026' })
    expect(prevQuarter('2026-Q1')).toEqual({ id: '2025-Q4', title: 'Oct–Dec 2025' })
  })
  it('exports a CSV with each contact’s dispatch status', () => {
    const c = { id: 1, name: 'Ms. Asha "A" Singh', designation: null, company: '360 Realtors', address: 'Sector 43, Gurugram', city: 'Gurugram', pin: '122002', phone: '99538', email: null, remark: null }
    const csv = mailingCsv([c], new Map([[1, { id: 1, status: 'sent' as const, courier: 'DTDC', tracking: null, byName: 'Owner', at: '' }]]), 'Oct–Dec 2026')
    const [head, row] = csv.replace('﻿', '').split('\r\n')
    expect(head).toContain('"Status (Oct–Dec 2026)"')
    expect(row).toBe('"Ms. Asha ""A"" Singh","","360 Realtors","Sector 43, Gurugram","Gurugram","122002","99538","","Sent","DTDC",""')
  })
})
