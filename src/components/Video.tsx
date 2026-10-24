import { useEffect, useState } from 'react'
import { formatDate } from '../lib/format.ts'
import { shareLink } from '../lib/share.ts'
import type { Video } from '../lib/youtubeFeed.ts'
import { useOnline } from '../lib/hooks.ts'
import { Icon } from './Icon.tsx'
import { toast } from './Toast.tsx'
import { whatsappShareUrl } from '../lib/config.ts'

export function VideoCard({ video, onPlay, wide = false }: { video: Video; onPlay: (v: Video) => void; wide?: boolean }) {
  return (
    <button className={`video-card ${wide ? 'wide' : ''}`} onClick={() => onPlay(video)}>
      <span className="video-thumb">
        <img src={video.thumb} alt="" loading="lazy" decoding="async" />
        <span className="play-badge">
          <Icon name="play" size={18} filled />
        </span>
      </span>
      <span className="video-title">{video.title}</span>
      <span className="meta">
        {formatDate(video.published)}
        {video.views !== undefined && ` · ${video.views.toLocaleString('en-IN')} views`}
      </span>
    </button>
  )
}

export function VideoPlayer({ video, onClose }: { video: Video | null; onClose: () => void }) {
  const online = useOnline()
  const [showNotes, setShowNotes] = useState(false)

  useEffect(() => {
    if (!video) return
    setShowNotes(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [video, onClose])

  if (!video) return null
  const share = async () => {
    const r = await shareLink(video.title, video.url)
    if (r === 'copied') toast('Link copied')
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={video.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-bar">
          <button className="icon-btn" onClick={onClose} aria-label="Close player">
            <Icon name="close" />
          </button>
        </div>
        <div className="player">
          {online ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`}
              title={video.title}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : (
            <div className="player-offline">
              <Icon name="offline" size={28} />
              <p>Videos need an internet connection.</p>
            </div>
          )}
        </div>
        <div className="sheet-body">
          <h2 className="sheet-title">{video.title}</h2>
          <p className="meta">
            {formatDate(video.published)}
            {video.views !== undefined && ` · ${video.views.toLocaleString('en-IN')} views`}
          </p>
          <div className="action-row">
            <button className="btn" onClick={share}>
              <Icon name="share" size={18} /> Share
            </button>
            <a className="btn ghost wa-share" href={whatsappShareUrl(`*${video.title}*\n\n${video.url}`)} target="_blank" rel="noopener noreferrer">
              <Icon name="whatsapp" size={18} /> WhatsApp
            </a>
            <a className="btn ghost" href={video.url} target="_blank" rel="noopener noreferrer">
              <Icon name="external" size={18} /> Watch on YouTube
            </a>
          </div>
          {video.description && (
            <div className="video-notes">
              <p className={showNotes ? '' : 'clamp-3'}>{video.description}</p>
              {video.description.length > 180 && (
                <button className="link-btn" onClick={() => setShowNotes((s) => !s)}>
                  {showNotes ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
