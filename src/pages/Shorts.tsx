import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, EmptyState } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDate } from '../lib/format.ts'
import { useAsync, useOnline } from '../lib/hooks.ts'
import { shareLink } from '../lib/share.ts'
import { loadShorts } from '../lib/videos.ts'
import type { Video } from '../lib/youtubeFeed.ts'
import { usePageTitle } from './usePageTitle.ts'

/** Full-screen vertical feed of the channel's YouTube Shorts; only the visible one plays. */
export function Shorts() {
  usePageTitle('Shorts')
  const res = useAsync('yt:shorts', () => loadShorts())
  const [active, setActive] = useState(0)
  const [started, setStarted] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const online = useOnline()

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index))
      },
      { root: list, threshold: 0.6 },
    )
    list.querySelectorAll('.short').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [res.data])

  if (res.error && !res.data) {
    return (
      <div className="page">
        <ErrorState error={res.error} onRetry={res.reload} />
      </div>
    )
  }
  if (res.data && res.data.length === 0) {
    return (
      <div className="page">
        <EmptyState title="No Shorts yet">
          <Link to="/videos">See all videos</Link>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="shorts" ref={listRef}>
      <Link to="/videos" className="shorts-back icon-btn" aria-label="Back to videos">
        <Icon name="back" />
      </Link>
      {(res.data ?? []).map((v, i) => (
        <section key={v.id} className="short" data-index={i} aria-label={v.title}>
          {online && started && i === active ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&playsinline=1&loop=1&playlist=${v.id}&rel=0`}
              title={v.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : (
            <button className="short-poster" onClick={() => (setStarted(true), setActive(i))} aria-label={`Play ${v.title}`}>
              <img src={v.thumb} alt="" loading={i < 2 ? 'eager' : 'lazy'} />
              <span className="play-badge big">
                <Icon name="play" size={26} filled />
              </span>
            </button>
          )}
          <ShortInfo video={v} />
        </section>
      ))}
      {!res.data && <div className="short sk" />}
    </div>
  )
}

function ShortInfo({ video }: { video: Video }) {
  const share = async () => {
    const r = await shareLink(video.title, `https://www.youtube.com/shorts/${video.id}`)
    if (r === 'copied') toast('Link copied')
  }
  return (
    <div className="short-info">
      <div className="short-text">
        <p className="short-title">{video.title}</p>
        <p className="short-meta">
          {formatDate(video.published)}
          {video.views !== undefined && ` · ${video.views.toLocaleString('en-IN')} views`}
        </p>
      </div>
      <div className="short-actions">
        <button className="icon-btn" onClick={share} aria-label="Share">
          <Icon name="share" />
        </button>
        <a className="icon-btn" href={`https://www.youtube.com/shorts/${video.id}`} target="_blank" rel="noopener noreferrer" aria-label="Open on YouTube">
          <Icon name="external" />
        </a>
      </div>
    </div>
  )
}
