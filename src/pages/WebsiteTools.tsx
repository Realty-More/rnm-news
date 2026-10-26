// "Website" tab in the Content Studio: real realtynmore.com views per story (the site's own
// Post Views Counter, saved hourly), what works best, and technical SEO next to rivals.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon.tsx'
import { ErrorState, SkeletonList } from '../components/States.tsx'
import { toast } from '../components/Toast.tsx'
import { formatDateTime } from '../lib/format.ts'
import { invalidate, useAsync } from '../lib/hooks.ts'
import { hasFullAccess, studio, studioPost } from '../lib/owner.ts'
import { Panel } from './StudioTools.tsx'

interface Row { id: number; title: string; link: string; section: string; published: string; views: number; gain24: number | null; gain7: number | null; app: number }
interface Avg<K> { key: K; stories: number; avg: number }
interface Traffic {
  updatedAt: string | null
  hoursTracked: number
  totals: { stories: number; views: number; gain24: number | null; gain7: number | null; avg: number; appOpens: number }
  top: { all: Row[]; day: Row[]; week: Row[]; app: Row[] }
  sections: Avg<string>[]
  hours: Avg<number>[]
  days: Avg<number>[]
  settled: number
}
interface SeoSite { name: string; sampled: number; blocked: boolean; score: number | null; ms: number | null; kb: number | null; rates: Record<string, number | null>; pages: { title: string; link: string; score: number | null }[] }
interface SeoCompare { generatedAt: string; checks: { key: string; label: string; fix: string }[]; sites: SeoSite[]; gaps: { key: string; label: string; fix: string }[] }

const n = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('en-IN'))
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`

function Bars<K extends string | number>({ rows, label }: { rows: Avg<K>[]; label: (k: K) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.avg))
  const best = rows.reduce<Avg<K> | null>((b, r) => (!b || r.avg > b.avg ? r : b), null)
  return (
    <div className="web-bars">
      {rows.map((r) => (
        <div key={String(r.key)} className={`web-bar ${best?.key === r.key ? 'best' : ''}`}>
          <span className="web-bar-label">{label(r.key)}</span>
          <span className="web-bar-track">
            <span style={{ width: `${(r.avg / max) * 100}%` }} />
          </span>
          <span className="web-bar-val">
            {n(r.avg)} <small>· {r.stories}</small>
          </span>
        </div>
      ))}
    </div>
  )
}

export function WebsiteTab() {
  const res = useAsync('studio:web-traffic', (s) => studio<Traffic>('web/traffic', undefined, s))
  const [view, setView] = useState<'day' | 'week' | 'all' | 'app'>('all')
  const [busy, setBusy] = useState(false)
  const isOwner = hasFullAccess()

  const refresh = async () => {
    setBusy(true)
    try {
      const r = await studioPost<{ result: string }>('web/refresh', {})
      toast(`Updated: ${r.result}`)
      invalidate('studio:web-traffic')
      res.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={4} />
  const d = res.data
  const rows = d.top[view]
  const collecting = (h: number) => d.hoursTracked < h

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <b>{n(d.totals.views)}</b>
          <span>Website views · {d.totals.stories} stories</span>
        </div>
        <div className="kpi">
          <b>{d.totals.gain24 == null ? '…' : `+${n(d.totals.gain24)}`}</b>
          <span>{collecting(24) ? `Views since tracking began (${d.hoursTracked}h)` : 'Views in the last 24 hours'}</span>
        </div>
        <div className="kpi">
          <b>{n(d.totals.avg)}</b>
          <span>Average views per story</span>
        </div>
        <div className="kpi">
          <b>{n(d.totals.appOpens)}</b>
          <span>Opens in the app (same stories)</span>
        </div>
      </div>
      <p className="panel-note web-source">
        Real counts from realtynmore.com’s own view counter (Post Views Counter plugin), saved every hour. {d.updatedAt ? `Last update ${formatDateTime(d.updatedAt)}.` : ''}{' '}
        {isOwner && (
          <button className="mini-btn" onClick={refresh} disabled={busy}>
            <Icon name="refresh" size={14} /> {busy ? 'Updating…' : 'Update now'}
          </button>
        )}
      </p>

      <Panel title="Top stories on the website" note="Tap a story to read it. App opens are shown next to website views.">
        <div className="segmented small web-seg" role="radiogroup" aria-label="Period">
          {(
            [
              ['day', 'Last 24 h'],
              ['week', '7 days'],
              ['all', 'All time'],
              ['app', 'In the app'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
              {label}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="panel-note">{view === 'day' || view === 'week' ? 'Collecting: needs a few hourly snapshots first.' : 'No data yet.'}</p>
        ) : (
          <ol className="web-top">
            {rows.map((r, i) => (
              <li key={r.id}>
                <span className="web-rank">{i + 1}</span>
                <Link to={`/article/${r.id}`} className="web-title">
                  {r.title}
                  <small>
                    {r.section} · {formatDateTime(r.published)}
                  </small>
                </Link>
                <span className="web-num">
                  <b>{n(view === 'day' ? r.gain24 : view === 'week' ? r.gain7 : view === 'app' ? r.app : r.views)}</b>
                  <small>{view === 'app' ? `${n(r.views)} web` : `${n(r.app)} app`}</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Which sections do best" note={`Average website views per story, stories 2 to 60 days old (${d.settled} stories). Number after the dot = stories.`}>
        {d.sections.length ? <Bars rows={d.sections} label={(k) => k} /> : <p className="panel-note">Needs stories older than 2 days; fills in over the next days.</p>}
      </Panel>

      <div className="web-two">
        <Panel title="Best hour to publish" note="Average views by the hour (IST) a story went live.">
          {d.hours.length >= 3 ? <Bars rows={d.hours} label={hourLabel} /> : <p className="panel-note">Fills in as more stories are tracked.</p>}
        </Panel>
        <Panel title="Best day to publish" note="Average views by weekday.">
          {d.days.length >= 3 ? <Bars rows={d.days} label={(k) => DAYS[k]} /> : <p className="panel-note">Fills in as more stories are tracked.</p>}
        </Panel>
      </div>

      <SeoVersus />

      <Panel title="Want Google’s full numbers too?" note="Search words people typed, traffic sources and countries come from Google Analytics and Search Console. realtynmore.com already has both (G-12LZJCCTN4). They can be added here for free once the website admin gives this app read-only access.">
        <></>
      </Panel>
    </>
  )
}

function SeoVersus() {
  const res = useAsync('studio:web-seo', (s) => studio<SeoCompare>('web/seo', undefined, s))
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={2} />
  const { sites, checks, gaps } = res.data
  const ok = sites.filter((s) => !s.blocked)
  const mark = (v: number | null | undefined) => (v == null ? '–' : v >= 0.99 ? '✓' : v <= 0.01 ? '✗' : `${Math.round(v * 100)}%`)
  return (
    <Panel title="SEO: us vs competitors" note={`The same 12 page checks on each site’s latest stories (Google’s basics for news). Checked ${formatDateTime(res.data.generatedAt)}; refreshes every 12 hours.`}>
      <div className="web-seo-scores">
        {ok.map((s) => (
          <div key={s.name} className={`web-seo-site ${s.name === 'RealtyNMore' ? 'us' : ''}`}>
            <b>{s.score ?? '–'}</b>
            <span>{s.name}</span>
            <small>
              {s.ms != null ? `${(s.ms / 1000).toFixed(1)}s load` : ''} · {s.kb ?? '–'} KB
            </small>
          </div>
        ))}
      </div>
      {gaps.length > 0 ? (
        <div className="web-gaps">
          <strong>Quick wins (rivals do this, we don’t yet):</strong>
          <ul>
            {gaps.map((g) => (
              <li key={g.key}>
                <b>{g.label}.</b> {g.fix}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="panel-note">We pass every check that rivals pass.</p>
      )}
      <div className="table-wrap">
        <table className="web-table">
          <thead>
            <tr>
              <th>Check</th>
              {ok.map((s) => (
                <th key={s.name}>{s.name === 'Hindustan Times Real Estate' ? 'HT' : s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.key}>
                <td>{c.label}</td>
                {ok.map((s) => (
                  <td key={s.name} className={(s.rates[c.key] ?? 0) >= 0.5 ? 'pass' : 'fail'}>
                    {mark(s.rates[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sites.some((s) => s.blocked) && <p className="panel-note">Not checked (site blocks automated visits): {sites.filter((s) => s.blocked).map((s) => s.name).join(', ')}.</p>}
    </Panel>
  )
}

interface YtRow { id: string; title: string; published: string; playlists: string; short: number | null; views: number; likes: number | null; thumb: string; gain24: number | null; gain7: number | null }
interface YtStats {
  updatedAt: string | null
  hoursTracked: number
  totals: { videos: number; views: number; likes: number; gain24: number | null; gain7: number | null; avg: number; likeRate: number | null }
  formats: { key: string; videos: number; avg: number; likeRate: number | null }[]
  playlists: { key: string; videos: number; avg: number }[]
  days: Avg<number>[]
  hours: Avg<number>[]
  top: { all: YtRow[]; day: YtRow[]; week: YtRow[]; shorts: YtRow[]; long: YtRow[] }
}

/** YouTube channel performance: views, likes, Shorts vs long, playlists, best time to post. */
export function YouTubeTab() {
  const res = useAsync('studio:yt', (s) => studio<YtStats>('yt', undefined, s))
  const [view, setView] = useState<'all' | 'day' | 'week' | 'shorts' | 'long'>('all')
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setBusy(true)
    try {
      const r = await studioPost<{ result: string }>('yt/refresh', {})
      toast(`Updated: ${r.result}`)
      res.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />
  if (!res.data) return <SkeletonList count={4} />
  const d = res.data
  const rows = d.top[view]
  const best = [...d.formats].sort((a, b) => b.avg - a.avg)[0]
  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <b>{n(d.totals.views)}</b>
          <span>Views · {d.totals.videos} videos tracked</span>
        </div>
        <div className="kpi">
          <b>{d.totals.gain24 == null ? '…' : `+${n(d.totals.gain24)}`}</b>
          <span>{d.hoursTracked < 24 ? `Views since tracking began (${d.hoursTracked}h)` : 'Views in the last 24 hours'}</span>
        </div>
        <div className="kpi">
          <b>{n(d.totals.avg)}</b>
          <span>Average views per video</span>
        </div>
        <div className="kpi">
          <b>{d.totals.likeRate == null ? n(d.totals.likes) : `${d.totals.likeRate}%`}</b>
          <span>{d.totals.likeRate == null ? 'Likes' : `Like rate (${n(d.totals.likes)} likes)`}</span>
        </div>
      </div>
      <p className="panel-note web-source">
        From the channel’s public YouTube feeds (latest uploads and playlists), saved every hour. {d.updatedAt ? `Last update ${formatDateTime(d.updatedAt)}.` : ''}{' '}
        <button className="mini-btn" onClick={refresh} disabled={busy}>
          <Icon name="refresh" size={14} /> {busy ? 'Updating…' : 'Update now'}
        </button>
      </p>

      <Panel title="Top videos" note="Tap to open on YouTube.">
        <div className="segmented small web-seg" role="radiogroup" aria-label="Period">
          {(
            [
              ['all', 'All time'],
              ['day', 'Last 24 h'],
              ['week', '7 days'],
              ['shorts', 'Shorts'],
              ['long', 'Long videos'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
              {label}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="panel-note">{view === 'day' || view === 'week' ? 'Collecting: needs a few hourly snapshots first.' : 'No videos yet.'}</p>
        ) : (
          <ol className="web-top yt-top">
            {rows.map((r, i) => (
              <li key={r.id}>
                <span className="web-rank">{i + 1}</span>
                <a href={`https://www.youtube.com/watch?v=${r.id}`} target="_blank" rel="noopener noreferrer" className="web-title yt-title">
                  <img src={r.thumb} alt="" loading="lazy" />
                  <span>
                    <span className="yt-t">{r.title}</span>
                    <small>
                      {r.short === 1 ? 'Short' : 'Video'}
                      {r.playlists ? ` · ${r.playlists}` : ''} · {formatDateTime(r.published)}
                    </small>
                  </span>
                </a>
                <span className="web-num">
                  <b>{n(view === 'day' ? r.gain24 : view === 'week' ? r.gain7 : r.views)}</b>
                  <small>{r.likes != null ? `${n(r.likes)} likes` : 'views'}</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <div className="web-two">
        <Panel title="Shorts vs long videos" note={best ? `${best.key} get more views on average.` : undefined}>
          <Bars rows={d.formats.map((f) => ({ key: f.key, stories: f.videos, avg: f.avg }))} label={(k) => k} />
        </Panel>
        <Panel title="Playlists" note="Average views per video.">
          {d.playlists.length ? <Bars rows={d.playlists.map((p) => ({ key: p.key, stories: p.videos, avg: p.avg }))} label={(k) => k} /> : <p className="panel-note">No playlist videos yet.</p>}
        </Panel>
      </div>
      <div className="web-two">
        <Panel title="Best day to post" note="Average views by the weekday a video went live (videos 2 to 120 days old).">
          {d.days.length >= 2 ? <Bars rows={d.days} label={(k) => DAYS[k]} /> : <p className="panel-note">Fills in as more videos are tracked.</p>}
        </Panel>
        <Panel title="Best hour to post" note="Average views by the hour (IST) a video went live.">
          {d.hours.length >= 2 ? <Bars rows={d.hours} label={hourLabel} /> : <p className="panel-note">Fills in as more videos are tracked.</p>}
        </Panel>
      </div>
    </>
  )
}
