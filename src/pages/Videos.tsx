import { useState } from 'react'
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
  const [shelf, setShelf] = useState<FeedKey>('latest')
  const [playing, setPlaying] = useState<Video | null>(null)
  const feed = useAsync(`yt:${shelf}`, () => loadFeed(shelf))

  return (
    <div className="page">
      <div className="page-head">
        <h1>Videos</h1>
        <p className="page-sub">From the Realty &amp; More YouTube channel</p>
      </div>
      <div className="chips" role="tablist" aria-label="Playlists">
        {SHELVES.map((k) => (
          <button key={k} role="tab" aria-selected={shelf === k} className={`chip ${shelf === k ? 'active' : ''}`} onClick={() => setShelf(k)}>
            {FEEDS[k].label}
          </button>
        ))}
      </div>
      <VideoGrid feed={feed} onPlay={setPlaying} moreUrl={FEEDS[shelf].playlistUrl} />
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
