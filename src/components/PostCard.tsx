import { useState } from 'react'
import { Link } from 'react-router-dom'
import { timeAgo } from '../lib/format.ts'
import { CURATED_CATEGORIES, type Post, type PostImage } from '../lib/wp.ts'

export function PostImg({ image, sizes, eager = false, className = '' }: { image: PostImage | null; sizes: string; eager?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (!image || failed) {
    return (
      <div className={`img-fallback ${className}`} aria-hidden="true">
        <span>R&amp;M</span>
      </div>
    )
  }
  return (
    <img
      className={className}
      src={image.src}
      srcSet={image.srcSet || undefined}
      sizes={sizes}
      alt={image.alt}
      width={image.width}
      height={image.height}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      crossOrigin="anonymous"
      onError={() => setFailed(true)}
    />
  )
}

/** The most specific known section for a post, e.g. "RERA" rather than the generic "News". */
export function primaryCategory(post: Post) {
  const known = post.categories.flatMap((c) => {
    const curated = CURATED_CATEGORIES.find((k) => k.id === c.id)
    return curated ? [curated] : []
  })
  return known.find((c) => c.slug !== 'news') ?? known[0] ?? null
}

export function Kicker({ post }: { post: Post }) {
  const cat = primaryCategory(post)
  return cat ? <span className="kicker">{cat.label}</span> : null
}

type Variant = 'hero' | 'row' | 'card' | 'compact'

export function PostCard({ post, variant = 'row', index }: { post: Post; variant?: Variant; index?: number }) {
  const to = `/article/${post.id}`
  const meta = <time dateTime={post.date}>{timeAgo(post.date)}</time>

  if (variant === 'hero') {
    return (
      <Link to={to} className="hero-card" state={{ post }}>
        <PostImg image={post.image} sizes="(min-width: 960px) 720px, 100vw" eager className="hero-img" />
        <div className="hero-body">
          <Kicker post={post} />
          <h2 className="hero-title">{post.title}</h2>
          {post.excerpt && <p className="hero-excerpt">{post.excerpt}</p>}
          <div className="meta">{meta}</div>
        </div>
      </Link>
    )
  }
  if (variant === 'card') {
    return (
      <Link to={to} className="v-card" state={{ post }}>
        <PostImg image={post.image} sizes="280px" className="v-card-img" />
        <Kicker post={post} />
        <h3 className="v-card-title">{post.title}</h3>
        <div className="meta">{meta}</div>
      </Link>
    )
  }
  if (variant === 'compact') {
    return (
      <Link to={to} className="compact-card" state={{ post }}>
        {index !== undefined && <span className="compact-num">{String(index + 1).padStart(2, '0')}</span>}
        <div>
          <h3 className="compact-title">{post.title}</h3>
          <div className="meta">{meta}</div>
        </div>
      </Link>
    )
  }
  return (
    <Link to={to} className="row-card" state={{ post }}>
      <div className="row-body">
        <Kicker post={post} />
        <h3 className="row-title">{post.title}</h3>
        <div className="meta">{meta}</div>
      </div>
      <PostImg image={post.image} sizes="120px" className="row-img" />
    </Link>
  )
}
