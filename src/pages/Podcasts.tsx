import { useState } from 'react'
import { VideoPlayer } from '../components/Video.tsx'
import { useAsync } from '../lib/hooks.ts'
import { loadPodcasts } from '../lib/videos.ts'
import { FEEDS, type Video } from '../lib/youtubeFeed.ts'
import { VideoGrid } from './Videos.tsx'
import { usePageTitle } from './usePageTitle.ts'

export function Podcasts() {
  usePageTitle('Podcasts')
  const [playing, setPlaying] = useState<Video | null>(null)
  const res = useAsync('yt:podcasts-merged', async () => ({ videos: await loadPodcasts() }))

  return (
    <div className="page">
      <div className="page-head">
        <h1>Podcasts</h1>
        <p className="page-sub">R&amp;M Podcast episodes and teasers, on YouTube</p>
      </div>
      <VideoGrid feed={res} onPlay={setPlaying} moreUrl={FEEDS.podcasts.playlistUrl} />
      <VideoPlayer video={playing} onClose={() => setPlaying(null)} />
    </div>
  )
}
