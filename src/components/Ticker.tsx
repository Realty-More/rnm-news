import { Link } from 'react-router-dom'
import { useAsync } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.ts'
import { fetchPosts } from '../lib/wp.ts'

/** Scrolling strip of the latest headlines under the header (pauses on hover/focus; static with reduced motion). */
export function Ticker() {
  const t = useT()
  const res = useAsync('ticker', (s) => fetchPosts({ perPage: 8 }, s))
  const posts = res.data?.posts ?? []
  if (posts.length === 0) return null
  const items = posts.map((p) => (
    <Link key={p.id} to={`/article/${p.id}`} state={{ post: p }} className="ticker-item">
      {p.title}
    </Link>
  ))
  return (
    <div className="ticker" role="region" aria-label={t('ticker.label')}>
      <span className="ticker-label">
        <span className="live-dot" aria-hidden="true" />
        {t('ticker.label')}
      </span>
      <div className="ticker-viewport">
        <div className="ticker-track">
          {items}
          {/* second copy makes the loop seamless; hidden from screen readers */}
          <span aria-hidden="true" className="ticker-copy">
            {posts.map((p) => (
              <span key={p.id} className="ticker-item">
                {p.title}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}
