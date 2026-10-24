// What the owner sets in the Content Studio for every reader: an announcement banner and an Editor's Pick.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../lib/hooks.ts'
import { PUSH_API } from '../lib/push.ts'
import { fetchPost } from '../lib/wp.ts'
import { Icon } from './Icon.tsx'
import { Kicker, PostImg } from './PostCard.tsx'

export interface SiteConfig {
  pin: { postId: number; until: string | null } | null
  banner: { id: string; text: string; link: string; until: string | null; tone: 'accent' | 'dark' } | null
}

export function useSiteConfig() {
  return useAsync(PUSH_API ? 'site:config' : null, async (signal) => {
    const res = await fetch(`${PUSH_API}/site/config`, { signal })
    if (!res.ok) throw new Error('config unavailable')
    return (await res.json()) as SiteConfig
  })
}

const DISMISSED = 'rnm-banner-dismissed'

export function AnnouncementBanner() {
  const cfg = useSiteConfig()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED)
    } catch {
      return null
    }
  })
  const b = cfg.data?.banner
  if (!b || dismissed === b.id) return null
  const close = () => {
    setDismissed(b.id)
    try {
      localStorage.setItem(DISMISSED, b.id)
    } catch {
      /* ignore */
    }
  }
  const content = (
    <>
      <Icon name="sparkle" size={16} />
      <span>{b.text}</span>
      {b.link && <Icon name="chevron" size={16} />}
    </>
  )
  return (
    <div className={`announce ${b.tone}`} role="status">
      {b.link ? (
        b.link.startsWith('#') ? (
          <Link to={b.link.slice(1)} className="announce-body">
            {content}
          </Link>
        ) : (
          <a href={b.link} target="_blank" rel="noopener noreferrer" className="announce-body">
            {content}
          </a>
        )
      ) : (
        <span className="announce-body">{content}</span>
      )}
      <button className="icon-btn" onClick={close} aria-label="Dismiss announcement">
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}

export function EditorsPick() {
  const cfg = useSiteConfig()
  const id = cfg.data?.pin?.postId
  const post = useAsync(id ? `pick:${id}` : null, (s) => fetchPost(String(id), s))
  const p = post.data
  if (!p) return null
  return (
    <Link to={`/article/${p.id}`} state={{ post: p }} className="pick-card">
      <PostImg image={p.image} sizes="(min-width: 960px) 360px, 40vw" className="pick-img" />
      <div className="pick-body">
        <span className="pick-label">
          <Icon name="sparkle" size={14} /> Editor’s Pick
        </span>
        <Kicker post={p} />
        <h2 className="pick-title">{p.title}</h2>
        {p.excerpt && <p className="pick-excerpt">{p.excerpt}</p>}
      </div>
    </Link>
  )
}
