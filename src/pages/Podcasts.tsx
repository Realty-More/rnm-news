import { useState } from 'react'
import { useT } from '../lib/i18n.ts'
import { VideoPlayer } from '../components/Video.tsx'
import { useAsync } from '../lib/hooks.ts'
import { loadPodcasts } from '../lib/videos.ts'
import { FEEDS, type Video } from '../lib/youtubeFeed.ts'
import { VideoGrid } from './Videos.tsx'
import { usePageTitle } from './usePageTitle.ts'

export function Podcasts() {
  usePageTitle('Podcasts')
  const t = useT()
  const [playing, setPlaying] = useState<Video | null>(null)
  const res = useAsync('yt:podcasts-merged', async () => ({ videos: await loadPodcasts() }))

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('podcasts.title')}</h1>
        <p className="page-sub">{t('podcasts.sub')}</p>
      </div>
      <VideoGrid feed={res} onPlay={setPlaying} moreUrl={FEEDS.podcasts.playlistUrl} />
      <VideoPlayer video={playing} onClose={() => setPlaying(null)} />
    </div>
  )
}
