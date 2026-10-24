// YouTube channel/playlist RSS (free, no API key). Pure: shared by the app and scripts/fetch-youtube.ts.
import { XMLParser } from 'fast-xml-parser'

export const CHANNEL_ID = 'UCwcl1hjjTWT2h5a6PTghlGw'
export const CHANNEL_URL = `https://www.youtube.com/channel/${CHANNEL_ID}`

export type FeedKey = 'latest' | 'podcasts' | 'podium' | 'webseries' | 'anniversary'

export const FEEDS: Record<FeedKey, { label: string; query: string; playlistUrl: string }> = {
  latest: { label: 'Latest', query: `channel_id=${CHANNEL_ID}`, playlistUrl: `${CHANNEL_URL}/videos` },
  podcasts: { label: 'R&M Podcasts & Teasers', query: 'playlist_id=PLFRkk1l-02a0', playlistUrl: 'https://www.youtube.com/playlist?list=PLFRkk1l-02a0' },
  podium: { label: 'R&M Podium', query: 'playlist_id=PLSq2OtKanrik', playlistUrl: 'https://www.youtube.com/playlist?list=PLSq2OtKanrik' },
  webseries: { label: 'Realty Web Series', query: 'playlist_id=PLsILYUhlDV4iHCDPN7r-iWpSn-9zN0qUK', playlistUrl: 'https://www.youtube.com/playlist?list=PLsILYUhlDV4iHCDPN7r-iWpSn-9zN0qUK' },
  anniversary: { label: 'R&M 7th Anniversary', query: 'playlist_id=PLsILYUhlDV4guaZFoSI4mlNj7ynX4-ql3', playlistUrl: 'https://www.youtube.com/playlist?list=PLsILYUhlDV4guaZFoSI4mlNj7ynX4-ql3' },
}

export const feedUrl = (key: FeedKey) => `https://www.youtube.com/feeds/videos.xml?${FEEDS[key].query}`

export interface Video {
  id: string
  title: string
  published: string
  description: string
  thumb: string
  url: string
  views?: number
}

export interface Feed {
  title: string
  videos: Video[]
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', htmlEntities: true })

const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])
const text = (v: unknown): string => (typeof v === 'object' && v !== null && '#text' in v ? String((v as { '#text': unknown })['#text']) : v == null ? '' : String(v))

export function parseFeed(xml: string): Feed {
  const doc = parser.parse(xml)
  const feed = doc?.feed
  if (!feed) throw new Error('Not a YouTube feed')
  const videos = asArray<Record<string, any>>(feed.entry).flatMap((e) => {
    const id = text(e['yt:videoId'])
    if (!id) return []
    const group = e['media:group'] ?? {}
    const views = Number(group['media:community']?.['media:statistics']?.['@views'])
    return [{
      id,
      title: text(e.title),
      published: text(e.published),
      description: text(group['media:description']),
      // hqdefault is always 480×360 and exists for every video.
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${id}`,
      views: Number.isFinite(views) ? views : undefined,
    }]
  })
  return { title: text(feed.title), videos }
}
