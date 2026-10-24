import { useMemo, useState } from 'react'
import { useT } from '../lib/i18n.ts'
import { Link } from 'react-router-dom'
import { ErrorState, EmptyState } from '../components/States.tsx'
import { Icon } from '../components/Icon.tsx'
import { VideoCard, VideoPlayer } from '../components/Video.tsx'
import { useAsync, type AsyncState } from '../lib/hooks.ts'
import { loadFeed } from '../lib/videos.ts'
import { FEEDS, type FeedKey, type Video } from '../lib/youtubeFeed.ts'
import { usePageTitle } from './usePageTitle.ts'

const SHELVES: FeedKey[] = ['latest', 'podium', 'webseries', 'anniversary']

export function Videos() {
  usePageTitle('Videos')
  const t = useT()
  const [shelf, setShelf] = useState<FeedKey>('latest')
  const [playing, setPlaying] = useState<Video | null>(null)
  const [sort, setSort] = useState<'new' | 'views'>('new')
  const feed = useAsync(`yt:${shelf}`, () => loadFeed(shelf))
  const sorted = useMemo(() => {
    if (!feed.data || sort === 'new') return feed
    const videos = [...feed.data.videos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    return { ...feed, data: { ...feed.data, videos } }
  }, [feed, sort])

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('videos.title')}</h1>
        <p className="page-sub">{t('videos.sub')}</p>
      </div>
      <div className="chips" role="tablist" aria-label="Playlists">
        {SHELVES.map((k) => (
          <button key={k} role="tab" aria-selected={shelf === k} className={`chip ${shelf === k ? 'active' : ''}`} onClick={() => setShelf(k)}>
            {FEEDS[k].label}
          </button>
        ))}
      </div>
      <div className="sort-row">
        <Link to="/shorts" className="shorts-link">
          <Icon name="play" size={16} filled /> {t('videos.shorts')}
        </Link>
        <div className="segmented small" role="radiogroup" aria-label="Sort videos">
          <button role="radio" aria-checked={sort === 'new'} className={sort === 'new' ? 'on' : ''} onClick={() => setSort('new')}>
            {t('videos.newest')}
          </button>
          <button role="radio" aria-checked={sort === 'views'} className={sort === 'views' ? 'on' : ''} onClick={() => setSort('views')}>
            <Icon name="flame" size={14} /> {t('videos.mostWatched')}
          </button>
        </div>
      </div>
      <VideoGrid feed={sorted} onPlay={setPlaying} moreUrl={FEEDS[shelf].playlistUrl} />
      <VideoPlayer video={playing} onClose={() => setPlaying(null)} />
    </div>
  )
}

export function VideoGrid({ feed, onPlay, moreUrl }: { feed: AsyncState<{ videos: Video[] }>; onPlay: (v: Video) => void; moreUrl: string }) {
  if (feed.error && !feed.data) return <ErrorState error={feed.error} onRetry={feed.reload} />
  if (!feed.data) {
    return (
      <div className="video-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="sk sk-video" />
        ))}
      </div>
    )
  }
  if (feed.data.videos.length === 0) return <EmptyState title="No videos in this playlist yet" />
  const [first, ...rest] = feed.data.videos
  return (
    <>
      <div className="video-grid">
        <VideoCard video={first} onPlay={onPlay} wide />
        {rest.map((v) => (
          <VideoCard key={v.id} video={v} onPlay={onPlay} />
        ))}
      </div>
      <div className="more-on-yt">
        <p>YouTube's free feed lists the latest {feed.data.videos.length} videos.</p>
        <a className="btn ghost" href={moreUrl} target="_blank" rel="noopener noreferrer">
          See more on YouTube <Icon name="external" size={16} />
        </a>
      </div>
    </>
  )
}
