import { useEffect, useRef, type ReactNode } from 'react'
import { useT } from '../lib/i18n.ts'
import { Icon } from './Icon.tsx'

export function SkeletonList({ count = 5, hero = false }: { count?: number; hero?: boolean }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label="Loading">
      {hero && <div className="sk sk-hero" />}
      {Array.from({ length: count }, (_, i) => (
        <div className="sk-row" key={i}>
          <div className="sk-lines">
            <div className="sk sk-kicker" />
            <div className="sk sk-line" />
            <div className="sk sk-line short" />
          </div>
          <div className="sk sk-thumb" />
        </div>
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const t = useT()
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  return (
    <div className="state">
      <Icon name={offline ? 'offline' : 'refresh'} size={28} />
      <p className="state-title">{offline ? t('state.offline') : t('state.failed')}</p>
      <p className="state-text">{offline ? 'Connect to the internet to see the latest stories. Saved articles still work offline.' : error.message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          {t('state.retry')}
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <p className="state-title">{title}</p>
      {children && <div className="state-text">{children}</div>}
    </div>
  )
}

/** Loads the next page when it scrolls into view; also offers a button for accessibility. */
export function LoadMore({ onMore, loading, done, error, onRetry }: { onMore: () => void; loading: boolean; done: boolean; error: Error | null; onRetry: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || done || error) return
    const io = new IntersectionObserver((e) => e[0].isIntersecting && onMore(), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [onMore, done, error])

  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (done) return <p className="list-end">{t('state.caughtUp')}</p>
  return (
    <div ref={ref} className="load-more">
      {loading ? <span className="spinner" aria-label="Loading more" /> : <button className="btn ghost" onClick={onMore}>{t('state.loadMore')}</button>}
    </div>
  )
}
