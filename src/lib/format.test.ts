import { describe, expect, it } from 'vitest'
import { cleanExcerpt, decodeEntities, gmtToIso, readingMinutes, timeAgo } from './format.ts'
import { slugFromSiteUrl, toImage, toPost, type RawPost } from './wp.ts'
import { parseFeed } from './youtubeFeed.ts'
import { sanitizeArticle } from './sanitize.ts'

describe('format', () => {
  it('decodes WordPress entities', () => {
    expect(decodeEntities('India&#8217;s Data Centre &amp; R&#x26;M &hellip;')).toBe('India’s Data Centre & R&M …')
    expect(decodeEntities('&unknown; stays')).toBe('&unknown; stays')
  })

  it('cleans excerpts', () => {
    expect(cleanExcerpt('<p>Mumbai, Oct 24: Text here [&hellip;]</p>')).toBe('Mumbai, Oct 24: Text here')
    expect(cleanExcerpt('<p>' + 'word '.repeat(100) + '</p>', 30).endsWith('…')).toBe(true)
  })

  it('treats WordPress date_gmt as UTC', () => {
    expect(gmtToIso('2026-10-24T07:11:49')).toBe('2026-10-24T07:11:49Z')
    expect(gmtToIso('2026-10-24T07:11:49Z')).toBe('2026-10-24T07:11:49Z')
  })

  it('formats relative time', () => {
    const now = Date.parse('2026-10-24T10:00:00Z')
    expect(timeAgo('2026-10-24T09:30:00Z', now)).toBe('30 min ago')
    expect(timeAgo('2026-10-24T05:00:00Z', now)).toBe('5h ago')
    expect(timeAgo('2026-10-01T05:00:00Z', now)).toBe('1 Oct 2026')
  })

  it('estimates reading time', () => {
    expect(readingMinutes('<p>' + 'a '.repeat(1100) + '</p>')).toBe(5)
  })
})

describe('wordpress mapping', () => {
  const raw: RawPost = {
    id: 1,
    slug: 'hello',
    date_gmt: '2026-10-24T07:11:49',
    modified_gmt: '2026-10-24T07:11:51',
    link: 'https://realtynmore.com/hello/',
    title: { rendered: 'Mumbai&#8217;s East&#8211;West' },
    excerpt: { rendered: '<p>Summary</p>' },
    categories: [1],
    _embedded: {
      'wp:featuredmedia': [{
        source_url: 'https://realtynmore.com/full.jpg',
        alt_text: '',
        media_details: { width: 2000, height: 1000, sizes: {
          thumbnail: { source_url: 'https://realtynmore.com/t.jpg', width: 150, height: 150 },
          medium_large: { source_url: 'https://realtynmore.com/m.jpg', width: 768, height: 384 },
          large: { source_url: 'https://realtynmore.com/l.jpg', width: 1024, height: 512 },
        } },
      }],
      'wp:term': [[{ id: 1, name: 'News', slug: 'news', taxonomy: 'category' }], [{ id: 9, name: 'tag', slug: 'tag', taxonomy: 'post_tag' }]],
    },
  }

  it('maps a post', () => {
    const p = toPost(raw)
    expect(p.title).toBe('Mumbai’s East–West')
    expect(p.date).toBe('2026-10-24T07:11:49Z')
    expect(p.categories).toEqual([{ id: 1, name: 'News', slug: 'news' }])
    expect(p.image?.src).toBe('https://realtynmore.com/m.jpg')
    expect(p.image?.srcSet).toBe('https://realtynmore.com/m.jpg 768w, https://realtynmore.com/l.jpg 1024w')
    expect(p.image?.alt).toBe('Mumbai’s East–West')
  })

  it('handles missing or private images', () => {
    expect(toImage(undefined, 'x')).toBeNull()
    expect(toImage({ code: 'rest_forbidden' }, 'x')).toBeNull()
    expect(toImage({ source_url: 'https://realtynmore.com/only.jpg' }, 'x')?.src).toBe('https://realtynmore.com/only.jpg')
  })

  it('recognises site post links', () => {
    expect(slugFromSiteUrl('https://realtynmore.com/luxury-projects-demand-rise-in-gurugram/')).toBe('luxury-projects-demand-rise-in-gurugram')
    expect(slugFromSiteUrl('https://www.realtynmore.com/some-post')).toBe('some-post')
    expect(slugFromSiteUrl('https://realtynmore.com/wp-content/uploads/a.jpg')).toBeNull()
    expect(slugFromSiteUrl('https://example.com/post/')).toBeNull()
  })
})

describe('youtube feed', () => {
  const xml = `<?xml version="1.0"?>
  <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
    <title>R&amp;M Podcasts &amp; Teasers</title>
    <entry>
      <yt:videoId>abc123</yt:videoId>
      <title>Goa Real Estate | R&amp;M Podcast</title>
      <published>2026-10-10T10:00:00+00:00</published>
      <media:group>
        <media:description>Episode notes</media:description>
        <media:community><media:statistics views="1234"/></media:community>
      </media:group>
    </entry>
  </feed>`

  it('parses entries', () => {
    const feed = parseFeed(xml)
    expect(feed.title).toBe('R&M Podcasts & Teasers')
    expect(feed.videos).toHaveLength(1)
    expect(feed.videos[0]).toMatchObject({ id: 'abc123', title: 'Goa Real Estate | R&M Podcast', views: 1234, description: 'Episode notes' })
  })

  it('rejects non-feeds', () => {
    expect(() => parseFeed('<html></html>')).toThrow()
  })
})

describe('sanitize', () => {
  it('strips scripts, styles and foreign iframes but keeps YouTube', () => {
    const out = sanitizeArticle(
      '<p style="width:100px">Hi<script>alert(1)</script></p><p>&nbsp;</p>' +
        '<iframe src="https://evil.example/x"></iframe><iframe src="https://www.youtube.com/embed/abc"></iframe>' +
        '<a href="https://example.com" onclick="x()">link</a><img src="https://realtynmore.com/a.jpg" onerror="x()">',
    )
    expect(out).not.toMatch(/script|style=|evil|onclick|onerror/)
    expect(out).toContain('youtube.com/embed/abc')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('loading="lazy"')
    expect(out).not.toContain('<p>&nbsp;</p>')
  })
})
