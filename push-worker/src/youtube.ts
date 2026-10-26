// YouTube performance for the Content Studio (owner).
//   Source: the app's own data/youtube.json (built from the channel's public feeds every 30 minutes:
//   views, likes, Shorts or not, playlist). Saved hourly here, so we can show views gained in the
//   last 24 hours and 7 days, Shorts vs long videos, playlists and the best time to post.
import { averageBy } from './website.ts'
import type { Env } from './index.ts'

const HOUR = 3600000
const IST = 5.5 * HOUR
const PLAYLIST: Record<string, string> = { latest: 'Latest', podcasts: 'Podcasts', podium: 'The Podium', webseries: 'Web series', anniversary: 'Anniversary' }

interface FeedVideo { id: string; title: string; published: string; thumb: string; url: string; views?: number; likes?: number; isShort?: boolean }

/** Hourly: saves views and likes for every video in the app's YouTube snapshot. */
export async function collectYouTube(env: Env): Promise<string> {
  const res = await fetch(`${env.APP_URL}data/youtube.json`, { cf: { cacheTtl: 0 } } as RequestInit)
  if (!res.ok) throw new Error(`youtube.json ${res.status}`)
  const data = (await res.json()) as { feeds: Record<string, { videos: FeedVideo[] }> }
  const videos = new Map<string, FeedVideo & { lists: string[] }>()
  for (const [key, feed] of Object.entries(data.feeds ?? {})) {
    for (const v of feed.videos ?? []) {
      if (typeof v.views !== 'number') continue
      const seen = videos.get(v.id)
      const list = PLAYLIST[key] ?? key
      if (seen) {
        if (key !== 'latest' && !seen.lists.includes(list)) seen.lists.push(list)
      } else videos.set(v.id, { ...v, lists: key === 'latest' ? [] : [list] })
    }
  }
  const hour = new Date().toISOString().slice(0, 13)
  const now = new Date().toISOString()
  const stmts = [...videos.values()].flatMap((v) => [
    env.DB.prepare(
      `INSERT INTO yt_videos (id, title, published, playlists, short, views, likes, thumb, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, playlists = CASE WHEN excluded.playlists != '' THEN excluded.playlists ELSE yt_videos.playlists END,
         short = COALESCE(excluded.short, yt_videos.short), views = excluded.views, likes = COALESCE(excluded.likes, yt_videos.likes), thumb = excluded.thumb, checked_at = excluded.checked_at`,
    ).bind(v.id, v.title, v.published, v.lists.join(', '), v.isShort === undefined ? null : v.isShort ? 1 : 0, v.views!, v.likes ?? null, v.thumb, now),
    env.DB.prepare('INSERT OR REPLACE INTO yt_views (id, hour, views) VALUES (?, ?, ?)').bind(v.id, hour, v.views!),
  ])
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100))
  await env.DB.prepare('DELETE FROM yt_views WHERE hour < ?').bind(new Date(Date.now() - 45 * 24 * HOUR).toISOString().slice(0, 13)).run()
  return `${videos.size} videos`
}

export interface YtRow { id: string; title: string; published: string; playlists: string; short: number | null; views: number; likes: number | null; thumb: string; gain24: number | null; gain7: number | null }

export async function youTubeStats(env: Env) {
  const since = (h: number) => new Date(Date.now() - h * HOUR).toISOString().slice(0, 13)
  const [{ results: vids }, first, { results: b24 }, { results: b7 }] = await Promise.all([
    env.DB.prepare('SELECT id, title, published, playlists, short, views, likes, thumb FROM yt_videos ORDER BY published DESC').all<Omit<YtRow, 'gain24' | 'gain7'>>(),
    env.DB.prepare('SELECT MIN(hour) AS h, MAX(hour) AS last FROM yt_views').first<{ h: string | null; last: string | null }>(),
    env.DB.prepare('SELECT id, MIN(views) AS v FROM yt_views WHERE hour >= ? GROUP BY id').bind(since(24)).all<{ id: string; v: number }>(),
    env.DB.prepare('SELECT id, MIN(views) AS v FROM yt_views WHERE hour >= ? GROUP BY id').bind(since(24 * 7)).all<{ id: string; v: number }>(),
  ])
  const m24 = new Map(b24.map((r) => [r.id, r.v]))
  const m7 = new Map(b7.map((r) => [r.id, r.v]))
  const hoursTracked = first?.h ? Math.round((Date.now() - Date.parse(`${first.h}:00:00Z`)) / HOUR) : 0
  const rows: YtRow[] = vids.map((v) => ({ ...v, gain24: m24.has(v.id) ? v.views - m24.get(v.id)! : null, gain7: m7.has(v.id) ? v.views - m7.get(v.id)! : null }))
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const top = (by: (r: YtRow) => number, filter: (r: YtRow) => boolean = () => true) => rows.filter(filter).filter((r) => by(r) > 0).sort((a, b) => by(b) - by(a)).slice(0, 10)
  const shorts = rows.filter((r) => r.short === 1)
  const longs = rows.filter((r) => r.short === 0)
  const avg = (xs: YtRow[]) => (xs.length ? Math.round(sum(xs.map((r) => r.views)) / xs.length) : 0)
  const likeRate = (xs: YtRow[]) => {
    const withLikes = xs.filter((r) => r.likes != null && r.views > 0)
    const v = sum(withLikes.map((r) => r.views))
    return v ? Math.round((sum(withLikes.map((r) => r.likes!)) / v) * 1000) / 10 : null
  }
  // Timing: videos 2 to 120 days old, so brand-new uploads don't drag the averages down.
  const settled = rows.filter((r) => {
    const age = Date.now() - Date.parse(r.published)
    return age >= 48 * HOUR && age <= 120 * 24 * HOUR
  })
  const ist = (iso: string) => new Date(Date.parse(iso) + IST)
  const byList = new Map<string, YtRow[]>()
  for (const r of rows) for (const l of r.playlists ? r.playlists.split(', ') : []) byList.set(l, [...(byList.get(l) ?? []), r])
  return {
    updatedAt: first?.last ? `${first.last}:00:00Z` : null,
    hoursTracked,
    totals: {
      videos: rows.length,
      views: sum(rows.map((r) => r.views)),
      likes: sum(rows.map((r) => r.likes ?? 0)),
      gain24: hoursTracked >= 1 ? sum(rows.map((r) => r.gain24 ?? 0)) : null,
      gain7: hoursTracked >= 24 ? sum(rows.map((r) => r.gain7 ?? 0)) : null,
      avg: avg(rows),
      likeRate: likeRate(rows),
    },
    formats: [
      { key: 'Shorts', videos: shorts.length, avg: avg(shorts), likeRate: likeRate(shorts) },
      { key: 'Long videos', videos: longs.length, avg: avg(longs), likeRate: likeRate(longs) },
    ],
    playlists: [...byList].map(([key, list]) => ({ key, videos: list.length, avg: avg(list) })).sort((a, b) => b.avg - a.avg),
    days: averageBy(settled, (r: YtRow) => ist(r.published).getUTCDay(), 2).sort((a, b) => a.key - b.key),
    hours: averageBy(settled, (r: YtRow) => ist(r.published).getUTCHours(), 2).sort((a, b) => a.key - b.key),
    top: {
      all: top((r) => r.views),
      day: top((r) => r.gain24 ?? 0),
      week: top((r) => r.gain7 ?? 0),
      shorts: top((r) => r.views, (r) => r.short === 1),
      long: top((r) => r.views, (r) => r.short === 0),
    },
    recent: rows.slice(0, 8),
  }
}
