import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PostCard } from '../components/PostCard.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { VideoCard, VideoPlayer } from '../components/Video.tsx'
import { Icon } from '../components/Icon.tsx'
import { useAsync } from '../lib/hooks.ts'
import { loadFeed } from '../lib/videos.ts'
import { fetchPosts, CURATED_CATEGORIES } from '../lib/wp.ts'
import type { Video } from '../lib/youtubeFeed.ts'
import { usePageTitle } from './usePageTitle.ts'

// Sections that publish regularly (see CURATED_CATEGORIES).
const HOME_SECTIONS = ['interviews', 'rera', 'leadership-updates', 'guest-column', 'blogs', 'report']

const today = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export function Home() {
  usePageTitle(null)
  const latest = useAsync('home:latest', (s) => fetchPosts({ perPage: 9 }, s))
  const [playing, setPlaying] = useState<Video | null>(null)

  return (
    <div className="page home">
      <div className="masthead">
        <span className="dateline">{today.format(new Date())}</span>
        <h1 className="masthead-title">Today in Real Estate</h1>
      </div>

      {latest.error && !latest.data ? (
        <ErrorState error={latest.error} onRetry={latest.reload} />
      ) : !latest.data ? (
        <SkeletonList hero count={4} />
      ) : (
        <div className="lead-grid">
          {latest.data.posts[0] && <PostCard post={latest.data.posts[0]} variant="hero" />}
          <section className="latest-col" aria-labelledby="latest-h">
            <div className="section-head">
              <h2 id="latest-h">Latest</h2>
              <Link to="/news" className="see-all">
                All news <Icon name="chevron" size={16} />
              </Link>
            </div>
            <div className="row-list">
              {latest.data.posts.slice(1, 7).map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>
          </section>
        </div>
      )}

      <VideoStrip onPlay={setPlaying} />

      {HOME_SECTIONS.map((slug) => {
        const cat = CURATED_CATEGORIES.find((c) => c.slug === slug)!
        return <CategorySection key={slug} id={cat.id} slug={cat.slug} label={cat.label} />
      })}

      <VideoPlayer video={playing} onClose={() => setPlaying(null)} />
    </div>
  )
}

function VideoStrip({ onPlay }: { onPlay: (v: Video) => void }) {
  const feed = useAsync('yt:latest', () => loadFeed('latest'))
  if (feed.error && !feed.data) return null // the Videos tab shows the full error
  return (
    <section className="band dark" aria-labelledby="watch-h">
      <div className="section-head">
        <h2 id="watch-h">Watch</h2>
        <Link to="/videos" className="see-all">
          All videos <Icon name="chevron" size={16} />
        </Link>
      </div>
      <div className="h-scroll">
        {feed.data
          ? feed.data.videos.slice(0, 8).map((v) => <VideoCard key={v.id} video={v} onPlay={onPlay} />)
          : Array.from({ length: 3 }, (_, i) => <div key={i} className="sk sk-video" />)}
      </div>
    </section>
  )
}

function CategorySection({ id, slug, label }: { id: number; slug: string; label: string }) {
  const res = useAsync(`home:cat:${id}`, (s) => fetchPosts({ category: id, perPage: 6 }, s))
  if (res.error && !res.data) return null
  if (res.data && res.data.posts.length === 0) return null
  return (
    <section className="band" aria-labelledby={`sec-${slug}`}>
      <div className="section-head">
        <h2 id={`sec-${slug}`}>{label}</h2>
        <Link to={`/category/${slug}`} className="see-all">
          More <Icon name="chevron" size={16} />
        </Link>
      </div>
      <div className="h-scroll">
        {res.data
          ? res.data.posts.map((p) => <PostCard key={p.id} post={p} variant="card" />)
          : Array.from({ length: 3 }, (_, i) => <div key={i} className="sk sk-card" />)}
      </div>
    </section>
  )
}
