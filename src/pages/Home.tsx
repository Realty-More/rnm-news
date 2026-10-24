import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PostCard, PostImg } from '../components/PostCard.tsx'
import { PullToRefresh } from '../components/PullToRefresh.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { TopicPicker } from '../components/TopicPicker.tsx'
import { VideoCard, VideoPlayer } from '../components/Video.tsx'
import { Icon } from '../components/Icon.tsx'
import { continueReading, onHistoryChange, readHistory, type HistoryItem } from '../lib/history.ts'
import { invalidate, useAsync } from '../lib/hooks.ts'
import { usePrefs } from '../lib/prefs.ts'
import { loadFeed } from '../lib/videos.ts'
import { fetchPosts, CURATED_CATEGORIES } from '../lib/wp.ts'
import type { Video } from '../lib/youtubeFeed.ts'
import { usePageTitle } from './usePageTitle.ts'

// Sections that publish regularly (see CURATED_CATEGORIES).
const HOME_SECTIONS = ['interviews', 'rera', 'leadership-updates', 'guest-column', 'blogs', 'report']
const POLL_MS = 5 * 60 * 1000

const today = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export function Home() {
  usePageTitle(null)
  const [prefs, update] = usePrefs()
  const latest = useAsync('home:latest', (s) => fetchPosts({ perPage: 9 }, s))
  const [playing, setPlaying] = useState<Video | null>(null)
  const [epoch, setEpoch] = useState(0)
  const fresh = useNewStories(latest.data?.posts[0]?.id)

  const refresh = useCallback(async () => {
    invalidate('home:')
    invalidate('yt:latest')
    setEpoch((e) => e + 1)
    latest.reload()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [latest])

  const topicIds = CURATED_CATEGORIES.filter((c) => prefs.topics.includes(c.slug)).map((c) => c.id)
  const sections = HOME_SECTIONS.filter((s) => !prefs.topics.includes(s))

  return (
    <PullToRefresh onRefresh={refresh}>
      <div className="page home">
        {fresh > 0 && (
          <button className="new-pill" onClick={refresh}>
            <Icon name="arrowUp" size={16} /> {fresh} new {fresh === 1 ? 'story' : 'stories'}
          </button>
        )}

        <div className="masthead">
          <span className="dateline">{today.format(new Date())}</span>
          <h1 className="masthead-title">Today in Real Estate</h1>
        </div>

        <ContinueReading />

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

        {!prefs.onboarded ? (
          <section className="onboard">
            <div className="onboard-head">
              <Icon name="sparkle" size={20} />
              <div>
                <h2>Make it your feed</h2>
                <p>Pick sections and cities you follow. You can change them anytime in Settings.</p>
              </div>
            </div>
            <TopicPicker topics={prefs.topics} cities={prefs.cities} onChange={(topics, cities) => update({ topics, cities })} />
            <div className="action-row">
              <button className="btn" onClick={() => update({ onboarded: true })}>
                {prefs.topics.length || prefs.cities.length ? 'Save my feed' : 'Skip for now'}
              </button>
            </div>
          </section>
        ) : (
          topicIds.length > 0 && <ForYou ids={topicIds} epoch={epoch} />
        )}

        {prefs.onboarded &&
          prefs.cities.map((city) => <CitySection key={city} city={city} epoch={epoch} />)}

        <VideoStrip onPlay={setPlaying} epoch={epoch} />

        {sections.map((slug) => {
          const cat = CURATED_CATEGORIES.find((c) => c.slug === slug)!
          return <CategorySection key={slug} id={cat.id} slug={cat.slug} label={cat.label} epoch={epoch} />
        })}

        <VideoPlayer video={playing} onClose={() => setPlaying(null)} />
      </div>
    </PullToRefresh>
  )
}

/** Counts stories published since the top one on screen; checks every 5 minutes while the app is open. */
function useNewStories(topId: number | undefined): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    setCount(0)
    if (!topId) return
    const check = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      try {
        const { posts } = await fetchPosts({ perPage: 10 })
        const idx = posts.findIndex((p) => p.id === topId)
        setCount(idx === -1 ? posts.length : idx)
      } catch {
        /* try again next time */
      }
    }
    const timer = setInterval(check, POLL_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [topId])
  return count
}

function ContinueReading() {
  const [item, setItem] = useState<HistoryItem | null>(() => continueReading(readHistory()))
  useEffect(() => onHistoryChange(() => setItem(continueReading(readHistory()))), [])
  if (!item) return null
  return (
    <Link to={`/article/${item.post.id}`} state={{ post: item.post }} className="continue-card">
      <PostImg image={item.post.image} sizes="72px" className="continue-img" />
      <div className="continue-body">
        <span className="continue-label">
          <Icon name="history" size={14} /> Continue reading · {Math.round(item.progress * 100)}%
        </span>
        <span className="continue-title">{item.post.title}</span>
        <span className="continue-bar">
          <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
        </span>
      </div>
    </Link>
  )
}

function ForYou({ ids, epoch }: { ids: number[]; epoch: number }) {
  const res = useAsync(`home:foryou:${ids.join(',')}:${epoch}`, (s) => fetchPosts({ categories: ids, perPage: 8 }, s))
  if (res.error && !res.data) return null
  return (
    <section className="band for-you" aria-labelledby="foryou-h">
      <div className="section-head">
        <h2 id="foryou-h">For You</h2>
        <Link to="/settings" className="see-all">
          Edit <Icon name="settings" size={15} />
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

function CitySection({ city, epoch }: { city: string; epoch: number }) {
  const res = useAsync(`home:city:${city}:${epoch}`, (s) => fetchPosts({ search: city, perPage: 6 }, s))
  if ((res.error && !res.data) || res.data?.posts.length === 0) return null
  return (
    <section className="band" aria-labelledby={`city-${city}`}>
      <div className="section-head">
        <h2 id={`city-${city}`}>{city}</h2>
        <Link to={`/search?q=${encodeURIComponent(city)}`} className="see-all">
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

function VideoStrip({ onPlay, epoch }: { onPlay: (v: Video) => void; epoch: number }) {
  const feed = useAsync(`yt:latest${epoch ? `:${epoch}` : ''}`, () => loadFeed('latest'))
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

function CategorySection({ id, slug, label, epoch }: { id: number; slug: string; label: string; epoch: number }) {
  const res = useAsync(`home:cat:${id}:${epoch}`, (s) => fetchPosts({ category: id, perPage: 6 }, s))
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
