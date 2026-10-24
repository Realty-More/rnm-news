import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { Kicker, PostCard, PostImg, primaryCategory } from '../components/PostCard.tsx'
import { EmptyState, ErrorState } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDateTime, readingMinutes } from '../lib/format.ts'
import { useAsync } from '../lib/hooks.ts'
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

  const res = useAsync(`post:${key}`, async (signal) => {
    try {
      return await fetchPost(key, signal)
    } catch (err) {
      // Offline: fall back to the copy saved on this device.
      const saved = id ? await getSaved(Number(id)) : undefined
      if (saved) return saved
      throw err
    }
  })
  const post = res.data ?? (preview && String(preview.id) === key ? preview : undefined)
  usePageTitle(post?.title ?? 'Article')

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [key])

  const html = useMemo(() => (res.data?.content ? sanitizeArticle(res.data.content) : ''), [res.data])

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
    <article className="page article">
      <header className="article-head">
        <Kicker post={post} />
        <h1 className="article-title">{post.title}</h1>
        <p className="meta">
          <time dateTime={post.date}>{formatDateTime(post.date)}</time>
          {res.data?.content && ` · ${readingMinutes(res.data.content)} min read`}
        </p>
        <ArticleActions post={res.data ?? null} fallback={post} />
      </header>

      {post.image && (
        <figure className="article-hero">
          <PostImg image={post.image} sizes="(min-width: 760px) 720px, 100vw" eager />
        </figure>
      )}

      {html ? (
        <div className="prose" onClick={onContentClick} dangerouslySetInnerHTML={{ __html: html }} />
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
          Originally published on <strong>realtynmore.com</strong>
        </p>
        <a className="btn" href={post.link} target="_blank" rel="noopener noreferrer">
          Read on website <Icon name="external" size={16} />
        </a>
      </aside>

      <Related post={post} />
    </article>
  )
}

function ArticleActions({ post, fallback }: { post: Post | null; fallback: Post }) {
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
    const r = await shareLink(fallback.title, fallback.link)
    if (r === 'copied') toast('Link copied')
    if (r === 'failed') toast('Could not share this link')
  }

  return (
    <div className="action-row">
      <button className={`btn ghost ${saved ? 'on' : ''}`} onClick={toggleSave} aria-pressed={saved}>
        <Icon name="bookmark" size={18} filled={saved} /> {saved ? 'Saved' : 'Save'}
      </button>
      <button className="btn ghost" onClick={share}>
        <Icon name="share" size={18} /> Share
      </button>
    </div>
  )
}

function Related({ post }: { post: Post }) {
  const cat = primaryCategory(post)
  const res = useAsync(cat ? `related:${cat.id}:${post.id}` : null, (s) => fetchPosts({ category: cat!.id, perPage: 4, exclude: [post.id] }, s))
  if (!cat || !res.data?.posts.length) return null
  return (
    <section className="related" aria-labelledby="related-h">
      <div className="section-head">
        <h2 id="related-h">More in {cat.label}</h2>
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
