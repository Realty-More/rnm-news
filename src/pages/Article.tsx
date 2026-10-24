import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { hindiUrl, useT } from '../lib/i18n.ts'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { ListenButton } from '../components/Listen.tsx'
import { Kicker, PostCard, PostImg, primaryCategory } from '../components/PostCard.tsx'
import { EmptyState, ErrorState } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDateTime, readingMinutes } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
import { recordRead } from '../lib/history.ts'
import { smartLink, trackOpen, trackShare } from '../lib/stats.ts'
import { whatsappShareUrl } from '../lib/config.ts'
import { WhatsAppCard } from '../components/WhatsAppCard.tsx'
import { getOfflinePost } from '../lib/offline.ts'
import { TEXT_SIZES, usePrefs } from '../lib/prefs.ts'
import { getSaved, isSaved, onSavedChange, removeSaved, savePost } from '../lib/saved.ts'
import { sanitizeArticle } from '../lib/sanitize.ts'
import { shareLink } from '../lib/share.ts'
import { categoryBySlug, fetchPost, fetchPosts, SITE, slugFromSiteUrl, type Post } from '../lib/wp.ts'
import { usePageTitle } from './usePageTitle.ts'

export function Article() {
  const { id, slug } = useParams()
  const key = id ?? slug ?? ''
  const preview = (useLocation().state as { post?: Post } | null)?.post
  const navigate = useNavigate()
  const t = useT()

  const res = useAsync(`post:${key}`, async (signal) => {
    try {
      return await fetchPost(key, signal)
    } catch (err) {
      // Offline: fall back to a copy on this device (saved, or auto-downloaded).
      const local = id ? ((await getSaved(Number(id))) ?? (await getOfflinePost(Number(id)))) : undefined
      if (local) return local
      throw err
    }
  })
  const post = res.data ?? (preview && String(preview.id) === key ? preview : undefined)
  usePageTitle(post?.title ?? 'Article')

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [key])

  const html = useMemo(() => (res.data?.content ? sanitizeArticle(res.data.content) : ''), [res.data])
  const articleRef = useRef<HTMLElement>(null)
  const proseRef = useRef<HTMLDivElement>(null)
  const progress = useReadProgress(articleRef, res.data ?? null)
  const next = useNextStory(post ?? null)
  useSwipe(articleRef, post?.id, {
    onLeft: () => next && navigate(`/article/${next.id}`, { state: { post: next } }),
    onRight: () => (window.history.length > 1 ? navigate(-1) : undefined),
  })

  // Links to other realtynmore.com stories open inside the app.
  const onContentClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const s = slugFromSiteUrl(a.href)
    if (!s) return
    e.preventDefault()
    navigate(categoryBySlug(s) ? `/category/${s}` : `/read/${s}`)
  }

  if (res.error && !post) {
    return (
      <div className="page">
        <ErrorState error={res.error} onRetry={res.reload} />
      </div>
    )
  }
  if (res.data === null) {
    return (
      <div className="page">
        <EmptyState title="Story not found">
          It may have been moved or unpublished.{' '}
          <a href={slug ? `${SITE}/${slug}/` : SITE} target="_blank" rel="noopener noreferrer">
            Open realtynmore.com
          </a>
        </EmptyState>
      </div>
    )
  }
  if (!post) {
    return (
      <div className="page article">
        <div className="sk sk-kicker" />
        <div className="sk sk-title" />
        <div className="sk sk-title short" />
        <div className="sk sk-hero" />
      </div>
    )
  }

  return (
    <article className="page article" ref={articleRef}>
      <div className="read-progress" aria-hidden="true" style={{ transform: `scaleX(${progress})` }} />
      <header className="article-head">
        <Kicker post={post} />
        <h1 className="article-title">{post.title}</h1>
        <p className="meta">
          <time dateTime={post.date}>{formatDateTime(post.date)}</time>
          {res.data?.content && ` · ${readingMinutes(res.data.content)} ${t('article.minRead')}`}
        </p>
        <ArticleActions post={res.data ?? null} fallback={post} getText={() => proseRef.current?.innerText ?? ''} />
      </header>

      {post.image && (
        <figure className="article-hero">
          <PostImg image={post.image} sizes="(min-width: 760px) 720px, 100vw" eager />
        </figure>
      )}

      {html ? (
        <div className="prose" ref={proseRef} onClick={onContentClick} dangerouslySetInnerHTML={{ __html: html }} />
      ) : res.loading ? (
        <div className="prose-loading">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="sk sk-line" />
          ))}
        </div>
      ) : (
        post.excerpt && <p className="prose">{post.excerpt}</p>
      )}

      <aside className="source-box">
        <p>
          {t('article.source')} <strong>realtynmore.com</strong>
        </p>
        <a className="btn" href={post.link} target="_blank" rel="noopener noreferrer">
          {t('article.readOnSite')} <Icon name="external" size={16} />
        </a>
      </aside>

      {next && (
        <Link to={`/article/${next.id}`} state={{ post: next }} className="next-story">
          <span className="next-label">
            {t('article.next')} <Icon name="chevron" size={16} />
          </span>
          <span className="next-title">{next.title}</span>
          <span className="next-hint">{t('article.swipeHint')}</span>
        </Link>
      )}

      <WhatsAppCard />

      <Related post={post} />

      <div className="article-bar">
        <ArticleActions post={res.data ?? null} fallback={post} getText={() => proseRef.current?.innerText ?? ''} compact />
      </div>
    </article>
  )
}

/** Share of the article scrolled past (0..1); also keeps reading history up to date. */
function useReadProgress(ref: React.RefObject<HTMLElement | null>, post: Post | null): number {
  const [p, setP] = useState(0)
  const furthest = useRef(0)
  useEffect(() => {
    if (!post) return
    furthest.current = 0
    recordRead(post, 0)
    trackOpen(post.id)
    let frame = 0
    const measure = () => {
      frame = 0
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const total = r.height - window.innerHeight * 0.6
      const value = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 1
      furthest.current = Math.max(furthest.current, value)
      setP(value)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const save = () => recordRead(post, furthest.current)
    const timer = setInterval(save, 5000)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', save)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(timer)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', save)
      save()
    }
  }, [post, ref])
  return p
}

function ArticleActions({ post, fallback, getText, compact = false }: { post: Post | null; fallback: Post; getText: () => string; compact?: boolean }) {
  const [prefs, update] = usePrefs()
  const t = useT()
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const check = () => void isSaved(fallback.id).then(setSaved)
    check()
    return onSavedChange(check)
  }, [fallback.id])

  const toggleSave = async () => {
    if (saved) {
      await removeSaved(fallback.id)
      toast('Removed from Saved')
    } else {
      if (!post) return toast('Still loading the full story…')
      await savePost(post)
      toast('Saved. Available offline.')
    }
  }
  const share = async () => {
    const r = await shareLink(fallback.title, smartLink(fallback))
    if (r === 'shared' || r === 'copied') trackShare(fallback.id, r === 'copied' ? 'copy' : 'share')
    if (r === 'copied') toast('Link copied')
    if (r === 'failed') toast('Could not share this link')
  }

  return (
    <div className={`action-row ${compact ? 'compact' : ''}`}>
      <button className={`btn ghost ${saved ? 'on' : ''}`} onClick={toggleSave} aria-pressed={saved}>
        <Icon name="bookmark" size={18} filled={saved} /> {saved ? t('article.saved') : t('article.save')}
      </button>
      <button className="btn ghost" onClick={share}>
        <Icon name="share" size={18} /> {t('article.share')}
      </button>
      <a className="btn ghost wa-share" onClick={() => trackShare(fallback.id, 'whatsapp')} href={whatsappShareUrl(`*${fallback.title}*\n\n${smartLink(fallback)}`)} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp">
        <Icon name="whatsapp" size={18} /> {compact ? '' : 'WhatsApp'}
      </a>
      {post?.content && <ListenButton title={post.title} getText={getText} />}
      {prefs.lang === 'hi' && (
        <a className="btn ghost" href={hindiUrl(fallback.link)} target="_blank" rel="noopener noreferrer">
          {t('article.readHindi')} <Icon name="external" size={15} />
        </a>
      )}
      <button
        className="btn ghost icon-only"
        onClick={() => update({ textSize: (prefs.textSize + 1) % TEXT_SIZES.length })}
        aria-label="Change text size"
        title="Text size"
      >
        <Icon name="text" size={18} />
      </button>
    </div>
  )
}

/** The story published just before this one, in the same section when possible. */
function useNextStory(post: Post | null): Post | null {
  const cat = post ? primaryCategory(post) : null
  const res = useAsync(post ? `next:${post.id}` : null, (s) => fetchPosts({ category: cat?.id, before: post!.date, perPage: 1, exclude: [post!.id] }, s))
  return res.data?.posts[0] ?? null
}

/** Horizontal swipe on the article (ignores swipes that start in tables, videos or carousels). */
function useSwipe(ref: React.RefObject<HTMLElement | null>, key: unknown, { onLeft, onRight }: { onLeft: () => void; onRight: () => void }) {
  const handlers = useRef({ onLeft, onRight })
  handlers.current = { onLeft, onRight }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let start: { x: number; y: number; t: number } | null = null
    const down = (e: TouchEvent) => {
      const target = e.target as HTMLElement
      start = target.closest('table, iframe, .h-scroll, .chips') ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
    }
    const up = (e: TouchEvent) => {
      if (!start) return
      const dx = e.changedTouches[0].clientX - start.x
      const dy = e.changedTouches[0].clientY - start.y
      const quick = Date.now() - start.t < 600
      start = null
      if (!quick || Math.abs(dx) < 90 || Math.abs(dy) > 60) return
      if (dx < 0) handlers.current.onLeft()
      else handlers.current.onRight()
    }
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchend', up, { passive: true })
    return () => {
      el.removeEventListener('touchstart', down)
      el.removeEventListener('touchend', up)
    }
    // The article element only exists once the story has loaded.
  }, [ref, key])
}

function Related({ post }: { post: Post }) {
  const t = useT()
  const cat = primaryCategory(post)
  const res = useAsync(cat ? `related:${cat.id}:${post.id}` : null, (s) => fetchPosts({ category: cat!.id, perPage: 4, exclude: [post.id] }, s))
  if (!cat || !res.data?.posts.length) return null
  return (
    <section className="related" aria-labelledby="related-h">
      <div className="section-head">
        <h2 id="related-h">{t('article.moreIn')} {cat.label}</h2>
        <Link to={`/category/${cat.slug}`} className="see-all">
          All <Icon name="chevron" size={16} />
        </Link>
      </div>
      <div className="row-list">
        {res.data.posts.slice(0, 4).map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
    </section>
  )
}
