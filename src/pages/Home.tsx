import { useCallback, useEffect, useState } from 'react'
import { useT } from '../lib/i18n.ts'
import { Link } from 'react-router-dom'
import { PostCard, PostImg } from '../components/PostCard.tsx'
import { PullToRefresh } from '../components/PullToRefresh.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { TopicPicker } from '../components/TopicPicker.tsx'
import { NotifyPrompt } from '../components/NotifyToggle.tsx'
import { VideoCard, VideoPlayer } from '../components/Video.tsx'
import { Icon } from '../components/Icon.tsx'
import { WhatsAppCard } from '../components/WhatsAppCard.tsx'
import { EditorsPick } from '../components/SiteExtras.tsx'
import { SocialLinks } from '../components/SiteFooter.tsx'
import { MORE_REALTY, REALTY_INDEX, SENSEX, TvWidget, useNiftyRealty, useTvTheme } from '../components/TvWidget.tsx'
import { continueReading, onHistoryChange, readHistory, type HistoryItem } from '../lib/history.ts'
import { invalidate, useAsync } from '../lib/hooks.ts'
import { usePrefs } from '../lib/prefs.ts'
import { loadFeed } from '../lib/videos.ts'
import { fetchPosts, CURATED_CATEGORIES } from '../lib/wp.ts'
import type { Video } from '../lib/youtubeFeed.ts'
import { fetchTrending } from '../lib/stats.ts'
import { usePageTitle } from './usePageTitle.ts'

// Sections that publish regularly (see CURATED_CATEGORIES).
const HOME_SECTIONS = ['interviews', 'rera', 'leadership-updates', 'guest-column', 'blogs', 'report']
const POLL_MS = 5 * 60 * 1000

const todayFmt = (lang: string) => new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export function Home() {
  usePageTitle(null)
  const [prefs, update] = usePrefs()
  const t = useT()
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
            <Icon name="arrowUp" size={16} /> {t('home.newStories', { n: fresh })}
          </button>
        )}

        <div className="masthead">
          <span className="dateline">{todayFmt(prefs.lang).format(new Date())}</span>
          <h1 className="masthead-title">{t('home.title')}</h1>
        </div>

        <EditorsPick />

        <ContinueReading />
        {prefs.onboarded && <NotifyPrompt />}

        {latest.error && !latest.data ? (
          <ErrorState error={latest.error} onRetry={latest.reload} />
        ) : !latest.data ? (
          <SkeletonList hero count={4} />
        ) : (
          <div className="lead-grid">
            {latest.data.posts[0] && <PostCard post={latest.data.posts[0]} variant="hero" />}
            <section className="latest-col" aria-labelledby="latest-h">
              <div className="section-head">
                <h2 id="latest-h">{t('home.latest')}</h2>
                <Link to="/news" className="see-all">
                  {t('home.allNews')} <Icon name="chevron" size={16} />
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
                <h2>{t('home.onboardTitle')}</h2>
                <p>{t('home.onboardText')}</p>
              </div>
            </div>
            <TopicPicker topics={prefs.topics} cities={prefs.cities} onChange={(topics, cities) => update({ topics, cities })} />
            <div className="action-row">
              <button className="btn" onClick={() => update({ onboarded: true })}>
                {prefs.topics.length || prefs.cities.length ? t('home.saveFeed') : t('home.skip')}
              </button>
            </div>
          </section>
        ) : (
          topicIds.length > 0 && <ForYou ids={topicIds} epoch={epoch} />
        )}

        {prefs.onboarded &&
          prefs.cities.map((city) => <CitySection key={city} city={city} epoch={epoch} />)}

        <RealtyStrip />

        <Trending epoch={epoch} />

        <VideoStrip onPlay={setPlaying} epoch={epoch} />

        <div className="mobile-only-block">
          <WhatsAppCard />
        </div>

        {sections.map((slug) => {
          const cat = CURATED_CATEGORIES.find((c) => c.slug === slug)!
          return <CategorySection key={slug} id={cat.id} slug={cat.slug} label={cat.label} epoch={epoch} />
        })}

        <aside className="home-side" aria-label="More">
          <div className="side-sticky">
            <MostWatched onPlay={setPlaying} />
            <WhatsAppCard />
            <section className="side-box">
              <h2 className="side-title">{t('home.followUs')}</h2>
              <SocialLinks />
            </section>
          </div>
        </aside>

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
  const t = useT()
  const [item, setItem] = useState<HistoryItem | null>(() => continueReading(readHistory()))
  useEffect(() => onHistoryChange(() => setItem(continueReading(readHistory()))), [])
  if (!item) return null
  return (
    <Link to={`/article/${item.post.id}`} state={{ post: item.post }} className="continue-card">
      <PostImg image={item.post.image} sizes="72px" className="continue-img" />
      <div className="continue-body">
        <span className="continue-label">
          <Icon name="history" size={14} /> {t('home.continue')} · {Math.round(item.progress * 100)}%
        </span>
        <span className="continue-title">{item.post.title}</span>
        <span className="continue-bar">
          <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
        </span>
      </div>
    </Link>
  )
}

/** Scrolling realty stock prices (TradingView, BSE); the heading opens the Markets page. */
function RealtyStrip() {
  const t = useT()
  const theme = useTvTheme()
  const nifty = useNiftyRealty()
  return (
    <section className="band realty-strip" aria-labelledby="stocks-strip-h">
      <div className="section-head">
        <h2 id="stocks-strip-h">
          <Icon name="chart" size={18} /> {t('home.realtyStocks')}
        </h2>
        <Link to="/markets" className="see-all">
          {t('nav.markets')} <Icon name="chevron" size={16} />
        </Link>
      </div>
      <TvWidget
        kind="ticker-tape"
        height={46}
        config={{
          symbols: [SENSEX, REALTY_INDEX, ...nifty, ...MORE_REALTY].map((s) => ({ proName: s.symbol, title: s.name })),
          showSymbolLogo: true,
          isTransparent: true,
          displayMode: 'adaptive',
          colorTheme: theme,
          locale: 'en',
        }}
      />
    </section>
  )
}

/** Desktop sidebar: the channel's most-viewed recent videos (real YouTube view counts). */
function MostWatched({ onPlay }: { onPlay: (v: Video) => void }) {
  const t = useT()
  const feed = useAsync('yt:latest', () => loadFeed('latest'))
  const top = [...(feed.data?.videos ?? [])].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 4)
  if (!top.length) return null
  return (
    <section className="side-box">
      <h2 className="side-title">
        <Icon name="flame" size={16} /> {t('home.mostWatched')}
      </h2>
      <ol className="side-videos">
        {top.map((v) => (
          <li key={v.id}>
            <button onClick={() => onPlay(v)}>
              <img src={v.thumb} alt="" loading="lazy" />
              <span>
                <span className="side-video-title">{v.title}</span>
                <span className="meta">{v.views?.toLocaleString('en-IN')} views</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Most-read stories in the app over the last 2 days (hidden until there is enough real data). */
function Trending({ epoch }: { epoch: number }) {
  const t = useT()
  const res = useAsync(`home:trending:${epoch}`, (s) => fetchTrending(s))
  if (!res.data || res.data.length < 3) return null
  return (
    <section className="band trending" aria-labelledby="trending-h">
      <div className="section-head">
        <h2 id="trending-h">
          <Icon name="flame" size={18} /> {t('home.trending')}
        </h2>
      </div>
      <div className="trending-list">
        {res.data.slice(0, 5).map((p, i) => (
          <PostCard key={p.id} post={p} variant="compact" index={i} />
        ))}
      </div>
    </section>
  )
}

function ForYou({ ids, epoch }: { ids: number[]; epoch: number }) {
  const t = useT()
  const res = useAsync(`home:foryou:${ids.join(',')}:${epoch}`, (s) => fetchPosts({ categories: ids, perPage: 8 }, s))
  if (res.error && !res.data) return null
  return (
    <section className="band for-you" aria-labelledby="foryou-h">
      <div className="section-head">
        <h2 id="foryou-h">{t('home.forYou')}</h2>
        <Link to="/settings" className="see-all">
          {t('home.edit')} <Icon name="settings" size={15} />
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
  const t = useT()
  const res = useAsync(`home:city:${city}:${epoch}`, (s) => fetchPosts({ search: city, perPage: 6 }, s))
  if ((res.error && !res.data) || res.data?.posts.length === 0) return null
  return (
    <section className="band" aria-labelledby={`city-${city}`}>
      <div className="section-head">
        <h2 id={`city-${city}`}>{city}</h2>
        <Link to={`/search?q=${encodeURIComponent(city)}`} className="see-all">
          {t('home.more')} <Icon name="chevron" size={16} />
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
  const t = useT()
  const feed = useAsync(`yt:latest${epoch ? `:${epoch}` : ''}`, () => loadFeed('latest'))
  if (feed.error && !feed.data) return null // the Videos tab shows the full error
  return (
    <section className="band dark" aria-labelledby="watch-h">
      <div className="section-head">
        <h2 id="watch-h">{t('home.watch')}</h2>
        <Link to="/shorts" className="see-all shorts-pill">
          <Icon name="play" size={14} filled /> {t('videos.shorts')}
        </Link>
        <Link to="/videos" className="see-all">
          {t('home.allVideos')} <Icon name="chevron" size={16} />
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
  const t = useT()
  const res = useAsync(`home:cat:${id}:${epoch}`, (s) => fetchPosts({ category: id, perPage: 6 }, s))
  if (res.error && !res.data) return null
  if (res.data && res.data.posts.length === 0) return null
  return (
    <section className="band" aria-labelledby={`sec-${slug}`}>
      <div className="section-head">
        <h2 id={`sec-${slug}`}>{label}</h2>
        <Link to={`/category/${slug}`} className="see-all">
          {t('home.more')} <Icon name="chevron" size={16} />
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
