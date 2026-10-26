// 60-second briefing (after The Economist's Espresso and Axios): the top stories,
// each with its key points, to read in a minute or listen to hands-free.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { ListenButton } from '../components/Listen.tsx'
import { Kicker, PostImg } from '../components/PostCard.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { formatDateTime } from '../lib/format.ts'
import { ago, useT } from '../lib/i18n.ts'
import { useAsync } from '../lib/hooks.ts'
import { keyPoints, sentences } from '../lib/keypoints.ts'
import { fetchPosts } from '../lib/wp.ts'
import { usePageTitle } from './usePageTitle.ts'

const dayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })

export function Briefing() {
  usePageTitle('60-second briefing')
  const t = useT()
  const res = useAsync('briefing', (s) => fetchPosts({ perPage: 5, withContent: true }, s))
  const items = useMemo(
    () =>
      (res.data?.posts ?? []).map((post) => {
        const points = keyPoints(post.content ?? '', 2)
        // Short pieces: the first line of the summary the site already publishes.
        return { post, points: points.length ? points : sentences(post.excerpt).slice(0, 1) }
      }),
    [res.data],
  )
  const today = dayFmt.format(new Date())
  const script = () => items.map(({ post, points }, i) => `Story ${i + 1}. ${post.title}. ${points.join(' ')}`).join(' ')

  return (
    <div className="page briefing">
      <div className="masthead">
        <span className="dateline">{today}</span>
        <h1 className="masthead-title">{t('brief.title')}</h1>
        <p className="page-sub">{t('brief.sub')}</p>
        {items.length > 0 && (
          <div className="action-row brief-actions">
            <ListenButton title={`${t('brief.intro')}, ${today}`} getText={script} />
          </div>
        )}
      </div>

      {res.error && !res.data ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <SkeletonList count={5} />
      ) : (
        <ol className="brief-list">
          {items.map(({ post, points }, i) => (
            <li key={post.id} className="brief-item">
              <span className="brief-num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="brief-body">
                <Kicker post={post} />
                <Link to={`/article/${post.id}`} state={{ post }} className="brief-title">
                  {post.title}
                </Link>
                <span className="meta">{ago(post.date) ?? formatDateTime(post.date)}</span>
                {post.image && i === 0 && <PostImg image={post.image} sizes="(min-width: 760px) 640px, 100vw" className="brief-img" />}
                <ul className="brief-points">
                  {points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <Link to={`/article/${post.id}`} state={{ post }} className="see-all">
                  {t('brief.read')} <Icon name="chevron" size={15} />
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
