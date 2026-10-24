import { useSearchParams } from 'react-router-dom'
import { PostCard } from '../components/PostCard.tsx'
import { LoadMore, SkeletonList, EmptyState } from '../components/States.tsx'
import { Icon } from '../components/Icon.tsx'
import { PullToRefresh } from '../components/PullToRefresh.tsx'
import { useInfinitePosts } from '../lib/hooks.ts'
import { CURATED_CATEGORIES } from '../lib/wp.ts'
import { usePageTitle } from './usePageTitle.ts'

export function News() {
  const [params, setParams] = useSearchParams()
  const slug = params.get('c')
  const cat = CURATED_CATEGORIES.find((c) => c.slug === slug)
  usePageTitle(cat ? cat.label : 'News')

  return (
    <div className="page">
      <div className="page-head">
        <h1>{cat ? cat.label : 'All News'}</h1>
      </div>
      <div className="chips" role="tablist" aria-label="Filter by category">
        <button role="tab" aria-selected={!cat} className={`chip ${!cat ? 'active' : ''}`} onClick={() => setParams({}, { replace: true })}>
          All
        </button>
        {CURATED_CATEGORIES.filter((c) => c.slug !== 'news').map((c) => (
          <button
            key={c.slug}
            role="tab"
            aria-selected={cat?.slug === c.slug}
            className={`chip ${cat?.slug === c.slug ? 'active' : ''}`}
            onClick={() => setParams({ c: c.slug }, { replace: true })}
          >
            {c.label}
          </button>
        ))}
      </div>
      <PostFeed category={cat?.id} />
    </div>
  )
}

export function PostFeed({ category, search }: { category?: number; search?: string }) {
  const feed = useInfinitePosts({ category, search })
  if (feed.posts.length === 0 && feed.loading) return <SkeletonList count={6} />
  if (feed.posts.length === 0 && feed.done && !feed.error) {
    return <EmptyState title={search ? `No stories found for “${search}”` : 'No stories here yet'}>{search && 'Try a shorter word, a city or a company name.'}</EmptyState>
  }
  return (
    <PullToRefresh onRefresh={feed.refresh}>
      {!search && feed.posts.length > 0 && (
        <div className="feed-tools">
          <button className="link-btn" onClick={feed.refresh} disabled={feed.loading}>
            <Icon name="refresh" size={16} /> Refresh
          </button>
        </div>
      )}
      <div className="row-list feed">
        {feed.posts.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
      <LoadMore onMore={feed.loadMore} loading={feed.loading} done={feed.done} error={feed.error} onRetry={feed.reload} />
    </PullToRefresh>
  )
}
